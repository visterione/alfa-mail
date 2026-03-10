import { ImapFlow, type ImapFlowOptions, type FetchMessageObject } from 'imapflow';
import { getDb } from './db.js';
import { decrypt } from './crypto.js';
import type { Mailbox, EmailRule } from './db.js';

// Connection pool: mailboxId -> ImapFlow instance
const pool = new Map<number, ImapFlow>();

// In-flight connection promises — prevents simultaneous creation of two clients for the same mailbox
const connectionPromises = new Map<number, Promise<ImapFlow>>();

// Tracks which folders are currently being synced
const syncLocks = new Set<string>();

// Throttle: timestamp of last completed sync per key (mailboxId:folder)
const syncLastRun = new Map<string, number>();
const SYNC_MIN_INTERVAL_MS = 30_000; // don't re-sync the same folder more often than every 30 s

// Tracks background full-sync progress: key -> { done, total }
const fullSyncProgress = new Map<string, { done: number; total: number }>();

// ─── IMAP keepalive ───────────────────────────────────────────────────────────
// Send NOOP every 4 minutes to prevent server-side idle-timeout disconnection
setInterval(() => {
  for (const [mailboxId, client] of pool.entries()) {
    if (client.usable) {
      client.noop().catch(() => pool.delete(mailboxId));
    } else {
      pool.delete(mailboxId);
    }
  }
}, 4 * 60 * 1000);

// ─── Connection pool ──────────────────────────────────────────────────────────

async function getMailbox(mailboxId: number): Promise<Mailbox> {
  const sql = getDb();
  const [row] = await sql`SELECT * FROM mailboxes WHERE id = ${mailboxId}`;
  if (!row) throw new Error('Mailbox not found');
  return row as unknown as Mailbox;
}

function buildClientOptions(mb: Mailbox): ImapFlowOptions {
  return {
    host: mb.imap_host,
    port: mb.imap_port,
    secure: mb.imap_secure === 1,
    auth: { user: mb.email, pass: decrypt(mb.password_enc) },
    logger: false,
    tls: { rejectUnauthorized: false },
  };
}

export async function getClient(mailboxId: number): Promise<ImapFlow> {
  // Fast path: existing usable connection
  const existing = pool.get(mailboxId);
  if (existing?.usable) return existing;

  // If another coroutine is already creating a connection, wait for it
  const pending = connectionPromises.get(mailboxId);
  if (pending) return pending;

  // Create a new connection, serialised through the promise map so only one
  // connection is ever attempted at a time for a given mailboxId.
  const promise = (async () => {
    const recheck = pool.get(mailboxId);
    if (recheck?.usable) return recheck;

    const mb = await getMailbox(mailboxId);
    const client = new ImapFlow(buildClientOptions(mb));
    await client.connect();
    pool.set(mailboxId, client);
    client.on('close', () => pool.delete(mailboxId));
    client.on('error', () => pool.delete(mailboxId));
    return client;
  })();

  connectionPromises.set(mailboxId, promise);
  try {
    return await promise;
  } finally {
    connectionPromises.delete(mailboxId);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listFolders(mailboxId: number) {
  const client = await getClient(mailboxId);
  const list = await client.list();
  return list.map((f) => ({
    name: f.name,
    path: f.path,
    delimiter: f.delimiter,
    flags: [...f.flags],
    specialUse: f.specialUse ?? null,
    subscribed: f.subscribed,
  }));
}

export async function appendToSentFolder(mailboxId: number, rawMessage: Buffer): Promise<void> {
  const client = await getClient(mailboxId);
  const list = await client.list();

  const sentNames = ['sent', 'sent messages', 'sent items', 'отправленные'];
  const sentFolder =
    list.find((f) => f.specialUse === '\\Sent') ??
    list.find((f) => sentNames.includes(f.name.toLowerCase())) ??
    list.find((f) => sentNames.some((n) => f.path.toLowerCase().includes(n)));

  if (!sentFolder) {
    console.warn('[imap] Sent folder not found, skipping append');
    return;
  }

  await client.append(sentFolder.path, rawMessage, ['\\Seen']);
}

// Returns unread counts per folder from the local cache
export async function getUnreadCounts(mailboxId: number): Promise<Record<string, number>> {
  const sql = getDb();
  const rows = await sql`
    SELECT folder, COUNT(*) as cnt FROM message_cache
    WHERE mailbox_id = ${mailboxId} AND seen = 0
    GROUP BY folder
  `;
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.folder as string] = Number(row.cnt);
  }
  return result;
}

export async function listMessages(mailboxId: number, folder: string, page: number, pageSize: number) {
  const sql = getDb();
  const offset = (page - 1) * pageSize;

  const [countRow] = await sql`
    SELECT COUNT(*) as c FROM message_cache WHERE mailbox_id = ${mailboxId} AND folder = ${folder}
  `;
  const total = Number(countRow?.c ?? 0);

  const messages = await sql`
    SELECT * FROM message_cache
    WHERE mailbox_id = ${mailboxId} AND folder = ${folder}
    ORDER BY date DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const progressKey = `${mailboxId}:${folder}`;
  const progress = fullSyncProgress.get(progressKey) ?? null;

  return { total, messages, syncProgress: progress };
}

export async function getMessage(mailboxId: number, folder: string, uid: number) {
  const client = await getClient(mailboxId);
  let result: { uid: number; source: Buffer; envelope: Record<string, unknown> } | null = null;

  const lock = await client.getMailboxLock(folder);
  try {
    for await (const msg of client.fetch(`${uid}`, { uid: true, source: true, envelope: true, bodyStructure: true }, { uid: true })) {
      result = { uid: msg.uid, source: msg.source as Buffer, envelope: msg.envelope as unknown as Record<string, unknown> };
    }
  } finally {
    lock.release();
  }
  return result;
}

/**
 * Trigger sync for a folder.
 * - First call (no cache): quickly loads last 500 messages, then syncs the rest in background.
 * - Subsequent calls: loads only new messages since last sync.
 */
export async function syncFolder(mailboxId: number, folder: string): Promise<void> {
  const lockKey = `${mailboxId}:${folder}`;
  if (syncLocks.has(lockKey)) return;

  // Throttle: skip if the same folder was synced recently
  const lastRun = syncLastRun.get(lockKey) ?? 0;
  if (Date.now() - lastRun < SYNC_MIN_INTERVAL_MS) return;

  syncLocks.add(lockKey);

  try {
    const sql = getDb();
    const client = await getClient(mailboxId);
    const lock = await client.getMailboxLock(folder);

    try {
      const [stateRow] = await sql`
        SELECT last_uid, full_sync_done FROM sync_state
        WHERE mailbox_id = ${mailboxId} AND folder = ${folder}
      `;
      const lastUid = Number(stateRow?.last_uid ?? 0);
      const fullSyncDone = Number(stateRow?.full_sync_done ?? 0) === 1;

      const mailboxInfo = client.mailbox as { exists?: number } | undefined;
      const totalExists = mailboxInfo?.exists ?? 0;

      if (lastUid === 0 && totalExists > 0) {
        // ── FIRST SYNC: Phase 1 — fetch last 500 by sequence number ──────────
        const startSeq = Math.max(1, totalExists - 499);
        const rows: SyncRow[] = [];
        let maxUid = 0;

        for await (const msg of client.fetch(`${startSeq}:*`, {
          uid: true, envelope: true, flags: true, bodyStructure: true, size: true,
        })) {
          if (msg.uid > maxUid) maxUid = msg.uid;
          rows.push(buildRow(mailboxId, folder, msg));
          if (rows.length >= 200) await batchInsert(rows.splice(0));
        }
        if (rows.length > 0) await batchInsert(rows);

        if (maxUid > 0) {
          await upsertState(mailboxId, folder, maxUid, startSeq <= 1 ? 1 : 0);
        }

        await applyRulesToFolder(mailboxId, folder, rows).catch(() => {});

        // Phase 2 — sync older messages in background (don't block the response)
        if (startSeq > 1) {
          lock.release();
          syncLocks.delete(lockKey);
          syncLastRun.set(lockKey, Date.now());
          syncOlderMessages(mailboxId, folder, maxUid, startSeq - 1).catch(() => {});
          return;
        }
      } else {
        // ── INCREMENTAL SYNC: only fetch new messages ──────────────────────
        if (totalExists === 0) return;
        const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';
        const rows: SyncRow[] = [];
        let maxUid = lastUid;

        for await (const msg of client.fetch(range, {
          uid: true, envelope: true, flags: true, bodyStructure: true, size: true,
        }, { uid: true })) {
          if (msg.uid <= lastUid) continue;
          if (msg.uid > maxUid) maxUid = msg.uid;
          rows.push(buildRow(mailboxId, folder, msg));
          if (rows.length >= 200) await batchInsert(rows.splice(0));
        }
        if (rows.length > 0) await batchInsert(rows);
        if (maxUid > lastUid) {
          await upsertState(mailboxId, folder, maxUid, fullSyncDone ? 1 : 0);
          await applyRulesToFolder(mailboxId, folder, rows).catch(() => {});
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    syncLocks.delete(lockKey);
    syncLastRun.set(lockKey, Date.now());
  }
}

/**
 * Background task: sync messages older than what was loaded in Phase 1.
 */
async function syncOlderMessages(mailboxId: number, folder: string, knownMaxUid: number, maxSeq: number): Promise<void> {
  const progressKey = `${mailboxId}:${folder}`;
  fullSyncProgress.set(progressKey, { done: 0, total: maxSeq });

  try {
    const client = await getClient(mailboxId);
    const CHUNK = 500;
    let seqEnd = maxSeq;
    let totalDone = 0;

    while (seqEnd > 0) {
      const seqStart = Math.max(1, seqEnd - CHUNK + 1);
      const lock = await client.getMailboxLock(folder);
      const rows: SyncRow[] = [];

      try {
        for await (const msg of client.fetch(`${seqStart}:${seqEnd}`, {
          uid: true, envelope: true, flags: true, bodyStructure: true, size: true,
        })) {
          if (msg.uid >= knownMaxUid) continue;
          rows.push(buildRow(mailboxId, folder, msg));
          if (rows.length >= 200) await batchInsert(rows.splice(0));
        }
        if (rows.length > 0) await batchInsert(rows);
      } finally {
        lock.release();
      }

      totalDone += (seqEnd - seqStart + 1);
      fullSyncProgress.set(progressKey, { done: totalDone, total: maxSeq });
      seqEnd = seqStart - 1;
    }

    const sql = getDb();
    await sql`
      UPDATE sync_state SET full_sync_done = 1
      WHERE mailbox_id = ${mailboxId} AND folder = ${folder}
    `;
  } finally {
    fullSyncProgress.delete(progressKey);
  }
}

export async function setMessageFlags(mailboxId: number, folder: string, uid: number, flags: { seen?: boolean; flagged?: boolean }) {
  const client = await getClient(mailboxId);
  const lock = await client.getMailboxLock(folder);
  try {
    if (flags.seen !== undefined) {
      if (flags.seen) await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
      else await client.messageFlagsRemove(`${uid}`, ['\\Seen'], { uid: true });
    }
    if (flags.flagged !== undefined) {
      if (flags.flagged) await client.messageFlagsAdd(`${uid}`, ['\\Flagged'], { uid: true });
      else await client.messageFlagsRemove(`${uid}`, ['\\Flagged'], { uid: true });
    }
  } finally {
    lock.release();
  }

  const sql = getDb();
  if (flags.seen !== undefined) {
    await sql`UPDATE message_cache SET seen = ${flags.seen ? 1 : 0} WHERE mailbox_id = ${mailboxId} AND folder = ${folder} AND uid = ${uid}`;
  }
  if (flags.flagged !== undefined) {
    await sql`UPDATE message_cache SET flagged = ${flags.flagged ? 1 : 0} WHERE mailbox_id = ${mailboxId} AND folder = ${folder} AND uid = ${uid}`;
  }
}

export async function moveMessage(mailboxId: number, fromFolder: string, uid: number, toFolder: string) {
  const client = await getClient(mailboxId);
  const lock = await client.getMailboxLock(fromFolder);
  try {
    await client.messageMove(`${uid}`, toFolder, { uid: true });
  } finally {
    lock.release();
  }
  const sql = getDb();
  await sql`DELETE FROM message_cache WHERE mailbox_id = ${mailboxId} AND folder = ${fromFolder} AND uid = ${uid}`;
}

export async function deleteMessage(mailboxId: number, folder: string, uid: number) {
  const client = await getClient(mailboxId);
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageDelete(`${uid}`, { uid: true });
  } finally {
    lock.release();
  }
  const sql = getDb();
  await sql`DELETE FROM message_cache WHERE mailbox_id = ${mailboxId} AND folder = ${folder} AND uid = ${uid}`;
}

export async function createFolder(mailboxId: number, path: string): Promise<void> {
  const client = await getClient(mailboxId);
  await client.mailboxCreate(path);
}

export async function deleteFolder(mailboxId: number, path: string): Promise<void> {
  const client = await getClient(mailboxId);
  await client.mailboxDelete(path);
  const sql = getDb();
  await sql`DELETE FROM message_cache WHERE mailbox_id = ${mailboxId} AND folder = ${path}`;
  await sql`DELETE FROM sync_state WHERE mailbox_id = ${mailboxId} AND folder = ${path}`;
}

export async function renameFolder(mailboxId: number, oldPath: string, newPath: string): Promise<void> {
  const client = await getClient(mailboxId);
  await client.mailboxRename(oldPath, newPath);
  const sql = getDb();
  await sql`UPDATE message_cache SET folder = ${newPath} WHERE mailbox_id = ${mailboxId} AND folder = ${oldPath}`;
  await sql`UPDATE sync_state SET folder = ${newPath} WHERE mailbox_id = ${mailboxId} AND folder = ${oldPath}`;
}

export async function emptyFolder(mailboxId: number, folder: string): Promise<void> {
  const client = await getClient(mailboxId);
  const lock = await client.getMailboxLock(folder);
  try {
    const exists = (client.mailbox as { exists?: number })?.exists ?? 0;
    if (exists > 0) {
      await client.messageDelete('1:*', { uid: false });
    }
  } finally {
    lock.release();
  }
  const sql = getDb();
  await sql`DELETE FROM message_cache WHERE mailbox_id = ${mailboxId} AND folder = ${folder}`;
  await sql`DELETE FROM sync_state WHERE mailbox_id = ${mailboxId} AND folder = ${folder}`;
}

export async function markAllRead(mailboxId: number, folder: string): Promise<void> {
  const client = await getClient(mailboxId);
  const lock = await client.getMailboxLock(folder);
  try {
    const exists = (client.mailbox as { exists?: number })?.exists ?? 0;
    if (exists > 0) {
      await client.messageFlagsAdd('1:*', ['\\Seen'], { uid: false });
    }
  } finally {
    lock.release();
  }
  const sql = getDb();
  await sql`UPDATE message_cache SET seen = 1 WHERE mailbox_id = ${mailboxId} AND folder = ${folder}`;
}

export async function copyMessage(mailboxId: number, fromFolder: string, uid: number, toFolder: string): Promise<void> {
  const client = await getClient(mailboxId);
  const lock = await client.getMailboxLock(fromFolder);
  try {
    await client.messageCopy(`${uid}`, toFolder, { uid: true });
  } finally {
    lock.release();
  }
}

// ─── Full-text search ─────────────────────────────────────────────────────────

/**
 * Build a PostgreSQL tsquery from a user query string.
 * Each token becomes a term; the last token gets a :* prefix for partial matching.
 */
function buildTsQuery(q: string): string {
  const tokens = q.trim().split(/\s+/).filter(Boolean)
    .map(t => t.replace(/[&|!():*'"\\<>\s]/g, '').trim())
    .filter(Boolean);
  if (tokens.length === 0) return '';
  return tokens.map((t, i) => (i === tokens.length - 1 ? `${t}:*` : t)).join(' & ');
}

export async function searchMessages(
  mailboxId: number,
  query: string,
  folder?: string,
  limit = 50,
  offset = 0,
): Promise<{ total: number; messages: unknown[] }> {
  const sql = getDb();
  const tsq = buildTsQuery(query);
  if (!tsq) return { total: 0, messages: [] };

  const folderFilter = folder ? sql`AND folder = ${folder}` : sql``;

  const [countRow] = await sql`
    SELECT COUNT(*) as c FROM message_cache
    WHERE search_vector @@ to_tsquery('simple', ${tsq})
      AND mailbox_id = ${mailboxId} ${folderFilter}
  `;

  const messages = await sql`
    SELECT * FROM message_cache
    WHERE search_vector @@ to_tsquery('simple', ${tsq})
      AND mailbox_id = ${mailboxId} ${folderFilter}
    ORDER BY ts_rank(search_vector, to_tsquery('simple', ${tsq})) DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return { total: Number(countRow?.c ?? 0), messages };
}

// ─── Email Rules ──────────────────────────────────────────────────────────────

async function applyRulesToFolder(mailboxId: number, folder: string, rows: SyncRow[]): Promise<void> {
  if (rows.length === 0) return;

  const sql = getDb();
  const rules = await sql`
    SELECT * FROM email_rules
    WHERE mailbox_id = ${mailboxId} AND active = 1
    ORDER BY priority, id
  ` as unknown as EmailRule[];
  if (rules.length === 0) return;

  const client = await getClient(mailboxId);

  for (const row of rows) {
    for (const rule of rules) {
      if (!matchesRule(row, rule)) continue;

      try {
        if (rule.action === 'mark_read') {
          await setMessageFlags(mailboxId, folder, row.uid, { seen: true });
        } else if (rule.action === 'flag') {
          await setMessageFlags(mailboxId, folder, row.uid, { flagged: true });
        } else if (rule.action === 'move' && rule.action_param) {
          const lock = await client.getMailboxLock(folder);
          try {
            await client.messageMove(`${row.uid}`, rule.action_param, { uid: true });
          } finally {
            lock.release();
          }
          await sql`DELETE FROM message_cache WHERE mailbox_id = ${mailboxId} AND folder = ${folder} AND uid = ${row.uid}`;
          break;
        } else if (rule.action === 'delete') {
          const lock = await client.getMailboxLock(folder);
          try {
            await client.messageDelete(`${row.uid}`, { uid: true });
          } finally {
            lock.release();
          }
          await sql`DELETE FROM message_cache WHERE mailbox_id = ${mailboxId} AND folder = ${folder} AND uid = ${row.uid}`;
          break;
        }
      } catch {
        // Rule application errors are non-fatal
      }
    }
  }
}

function matchesRule(row: SyncRow, rule: EmailRule): boolean {
  const val = rule.condition_value.toLowerCase();
  let fieldValue = '';
  switch (rule.condition_field) {
    case 'from':    fieldValue = (row.from_addr ?? '') + ' ' + (row.from_name ?? ''); break;
    case 'to':      fieldValue = row.to_addrs ?? ''; break;
    case 'subject': fieldValue = row.subject ?? ''; break;
    case 'any':     fieldValue = [(row.from_addr ?? ''), (row.from_name ?? ''), (row.subject ?? ''), (row.to_addrs ?? '')].join(' '); break;
    default: return false;
  }
  fieldValue = fieldValue.toLowerCase();
  if (rule.condition_op === 'contains') return fieldValue.includes(val);
  if (rule.condition_op === 'equals')   return fieldValue.trim() === val;
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SyncRow = {
  mailbox_id: number; folder: string; uid: number; message_id: string | null;
  in_reply_to: string | null; thread_id: string | null;
  from_addr: string | null; from_name: string | null;
  to_addrs: string; cc_addrs: string | null;
  subject: string | null; date: number | null; has_attachments: number;
  seen: number; flagged: number; size: number | null;
};

function normalizeSubject(subject: string | null): string {
  if (!subject) return '';
  return subject.replace(/^(Re|Fwd|Fw|Ответ|Пересылка):\s*/gi, '').trim().toLowerCase();
}

function buildRow(mailboxId: number, folder: string, msg: FetchMessageObject): SyncRow {
  const env = msg.envelope;
  const from = env?.from?.[0];
  const flags = msg.flags ?? new Set<string>();
  const inReplyTo = env?.inReplyTo ?? null;
  const messageId = env?.messageId ?? null;
  const threadId = inReplyTo ?? messageId ?? normalizeSubject(env?.subject ?? null);

  return {
    mailbox_id: mailboxId,
    folder,
    uid: msg.uid,
    message_id: messageId,
    in_reply_to: inReplyTo,
    thread_id: threadId || null,
    from_addr: from?.address ?? null,
    from_name: from?.name ?? null,
    to_addrs: JSON.stringify((env?.to ?? []).map((a) => a.address)),
    cc_addrs: JSON.stringify((env?.cc ?? []).map((a) => ({ address: a.address, name: a.name }))),
    subject: env?.subject ?? null,
    date: env?.date ? Math.floor(new Date(env.date).getTime() / 1000) : null,
    has_attachments: hasAttachmentParts(msg.bodyStructure as BodyPart | null | undefined) ? 1 : 0,
    seen: flags.has('\\Seen') ? 1 : 0,
    flagged: flags.has('\\Flagged') ? 1 : 0,
    size: msg.size ?? null,
  };
}

async function batchInsert(rows: SyncRow[]) {
  if (rows.length === 0) return;
  const sql = getDb();

  const values = rows.map((r) => ({
    mailbox_id:      r.mailbox_id,
    folder:          r.folder,
    uid:             r.uid,
    message_id:      r.message_id,
    in_reply_to:     r.in_reply_to,
    thread_id:       r.thread_id,
    from_addr:       r.from_addr,
    from_name:       r.from_name,
    to_addrs:        r.to_addrs,
    cc_addrs:        r.cc_addrs,
    subject:         r.subject,
    date:            r.date,
    has_attachments: r.has_attachments,
    seen:            r.seen,
    flagged:         r.flagged,
    size:            r.size,
  }));

  await sql`
    INSERT INTO message_cache ${sql(values,
      'mailbox_id', 'folder', 'uid', 'message_id', 'in_reply_to', 'thread_id',
      'from_addr', 'from_name', 'to_addrs', 'cc_addrs', 'subject', 'date',
      'has_attachments', 'seen', 'flagged', 'size'
    )}
    ON CONFLICT (mailbox_id, folder, uid) DO UPDATE SET
      message_id      = EXCLUDED.message_id,
      in_reply_to     = EXCLUDED.in_reply_to,
      thread_id       = EXCLUDED.thread_id,
      from_addr       = EXCLUDED.from_addr,
      from_name       = EXCLUDED.from_name,
      to_addrs        = EXCLUDED.to_addrs,
      cc_addrs        = EXCLUDED.cc_addrs,
      subject         = EXCLUDED.subject,
      date            = EXCLUDED.date,
      has_attachments = EXCLUDED.has_attachments,
      seen            = EXCLUDED.seen,
      flagged         = EXCLUDED.flagged,
      size            = EXCLUDED.size
  `;
}

async function upsertState(mailboxId: number, folder: string, lastUid: number, fullSyncDone: number) {
  const sql = getDb();
  await sql`
    INSERT INTO sync_state (mailbox_id, folder, last_uid, full_sync_done, last_synced)
    VALUES (${mailboxId}, ${folder}, ${lastUid}, ${fullSyncDone}, EXTRACT(EPOCH FROM NOW())::INTEGER)
    ON CONFLICT (mailbox_id, folder) DO UPDATE SET
      last_uid       = GREATEST(sync_state.last_uid, EXCLUDED.last_uid),
      full_sync_done = GREATEST(sync_state.full_sync_done, EXCLUDED.full_sync_done),
      last_synced    = EXCLUDED.last_synced
  `;
}

type BodyPart = { type?: string; disposition?: { type?: string }; childNodes?: BodyPart[] };

function hasAttachmentParts(structure: BodyPart | null | undefined): boolean {
  if (!structure) return false;
  if (structure.disposition?.type?.toLowerCase() === 'attachment') return true;
  if (structure.childNodes) return structure.childNodes.some(hasAttachmentParts);
  return false;
}
