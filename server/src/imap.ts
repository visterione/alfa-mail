import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { getDb } from './db.js';
import { decrypt } from './crypto.js';
import type { Mailbox } from './db.js';

// Connection pool: mailboxId -> ImapFlow instance
const pool = new Map<number, ImapFlow>();
const syncLocks = new Set<string>();

async function getMailbox(mailboxId: number): Promise<Mailbox> {
  const db = getDb();
  const res = await db.execute({ sql: 'SELECT * FROM mailboxes WHERE id = ?', args: [mailboxId] });
  if (!res.rows[0]) throw new Error('Mailbox not found');
  return res.rows[0] as unknown as Mailbox;
}

function buildClientOptions(mb: Mailbox): ImapFlowOptions {
  const password = decrypt(mb.password_enc);
  return {
    host: mb.imap_host,
    port: mb.imap_port,
    secure: mb.imap_secure === 1,
    auth: { user: mb.email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  };
}

export async function getClient(mailboxId: number): Promise<ImapFlow> {
  let client = pool.get(mailboxId);
  if (client && client.usable) return client;

  const mb = await getMailbox(mailboxId);
  client = new ImapFlow(buildClientOptions(mb));
  await client.connect();
  pool.set(mailboxId, client);

  client.on('close', () => pool.delete(mailboxId));
  client.on('error', () => pool.delete(mailboxId));

  return client;
}

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

export async function listMessages(
  mailboxId: number,
  folder: string,
  page: number,
  pageSize: number
) {
  const db = getDb();
  const offset = (page - 1) * pageSize;

  const countRes = await db.execute({
    sql: 'SELECT COUNT(*) as c FROM message_cache WHERE mailbox_id = ? AND folder = ?',
    args: [mailboxId, folder],
  });
  const total = Number(countRes.rows[0]?.c ?? 0);

  const msgsRes = await db.execute({
    sql: `SELECT * FROM message_cache
          WHERE mailbox_id = ? AND folder = ?
          ORDER BY date DESC
          LIMIT ? OFFSET ?`,
    args: [mailboxId, folder, pageSize, offset],
  });

  return { total, messages: msgsRes.rows };
}

export async function getMessage(mailboxId: number, folder: string, uid: number) {
  const client = await getClient(mailboxId);
  let result: { uid: number; source: Buffer; envelope: Record<string, unknown> } | null = null;

  const lock = await client.getMailboxLock(folder);
  try {
    for await (const msg of client.fetch(
      `${uid}`,
      { uid: true, source: true, envelope: true, bodyStructure: true },
      { uid: true }
    )) {
      result = {
        uid: msg.uid,
        source: msg.source,
        envelope: msg.envelope as Record<string, unknown>,
      };
    }
  } finally {
    lock.release();
  }

  return result;
}

export async function syncFolder(mailboxId: number, folder: string): Promise<void> {
  const lockKey = `${mailboxId}:${folder}`;
  if (syncLocks.has(lockKey)) return;
  syncLocks.add(lockKey);

  try {
    const db = getDb();
    const client = await getClient(mailboxId);
    const lock = await client.getMailboxLock(folder);

    try {
      const stateRes = await db.execute({
        sql: 'SELECT last_uid FROM sync_state WHERE mailbox_id = ? AND folder = ?',
        args: [mailboxId, folder],
      });

      const lastUid = Number(stateRes.rows[0]?.last_uid ?? 0);
      const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';

      let maxUid = lastUid;
      const rows: {
        mailbox_id: number; folder: string; uid: number; message_id: string | null;
        from_addr: string | null; from_name: string | null; to_addrs: string;
        subject: string | null; date: number | null; has_attachments: number;
        seen: number; flagged: number; size: number | null;
      }[] = [];

      for await (const msg of client.fetch(
        range,
        { uid: true, envelope: true, flags: true, bodyStructure: true, size: true },
        { uid: true }
      )) {
        if (msg.uid <= lastUid) continue;
        if (msg.uid > maxUid) maxUid = msg.uid;

        const from = (msg.envelope?.from?.[0] as { address?: string; name?: string } | undefined);
        const hasAttachments = hasAttachmentParts(msg.bodyStructure);
        const flags = msg.flags ?? new Set<string>();

        rows.push({
          mailbox_id: mailboxId,
          folder,
          uid: msg.uid,
          message_id: (msg.envelope?.messageId as string | null | undefined) ?? null,
          from_addr: from?.address ?? null,
          from_name: from?.name ?? null,
          to_addrs: JSON.stringify(
            ((msg.envelope?.to as { address?: string }[] | undefined) ?? []).map((a) => a.address)
          ),
          subject: (msg.envelope?.subject as string | null | undefined) ?? null,
          date: msg.envelope?.date
            ? Math.floor(new Date(msg.envelope.date as string | Date).getTime() / 1000)
            : null,
          has_attachments: hasAttachments ? 1 : 0,
          seen: flags.has('\\Seen') ? 1 : 0,
          flagged: flags.has('\\Flagged') ? 1 : 0,
          size: msg.size ?? null,
        });

        // Batch insert every 200 messages
        if (rows.length >= 200) {
          await batchInsert(rows.splice(0));
        }
      }

      if (rows.length > 0) await batchInsert(rows);

      if (maxUid > lastUid) {
        await db.execute({
          sql: `INSERT INTO sync_state (mailbox_id, folder, last_uid, last_synced) VALUES (?, ?, ?, unixepoch())
                ON CONFLICT(mailbox_id, folder) DO UPDATE SET last_uid = excluded.last_uid, last_synced = excluded.last_synced`,
          args: [mailboxId, folder, maxUid],
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    syncLocks.delete(lockKey);
  }
}

async function batchInsert(rows: {
  mailbox_id: number; folder: string; uid: number; message_id: string | null;
  from_addr: string | null; from_name: string | null; to_addrs: string;
  subject: string | null; date: number | null; has_attachments: number;
  seen: number; flagged: number; size: number | null;
}[]) {
  const db = getDb();
  const statements = rows.map((r) => ({
    sql: `INSERT OR REPLACE INTO message_cache
            (mailbox_id, folder, uid, message_id, from_addr, from_name, to_addrs, subject, date, has_attachments, seen, flagged, size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      r.mailbox_id, r.folder, r.uid, r.message_id, r.from_addr, r.from_name,
      r.to_addrs, r.subject, r.date, r.has_attachments, r.seen, r.flagged, r.size,
    ],
  }));
  await db.batch(statements, 'write');
}

export async function setMessageFlags(
  mailboxId: number,
  folder: string,
  uid: number,
  flags: { seen?: boolean; flagged?: boolean }
) {
  const client = await getClient(mailboxId);
  const lock = await client.getMailboxLock(folder);
  try {
    if (flags.seen !== undefined) {
      if (flags.seen) {
        await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(`${uid}`, ['\\Seen'], { uid: true });
      }
    }
    if (flags.flagged !== undefined) {
      if (flags.flagged) {
        await client.messageFlagsAdd(`${uid}`, ['\\Flagged'], { uid: true });
      } else {
        await client.messageFlagsRemove(`${uid}`, ['\\Flagged'], { uid: true });
      }
    }
  } finally {
    lock.release();
  }

  // Update cache
  const db = getDb();
  if (flags.seen !== undefined) {
    await db.execute({ sql: 'UPDATE message_cache SET seen = ? WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [flags.seen ? 1 : 0, mailboxId, folder, uid] });
  }
  if (flags.flagged !== undefined) {
    await db.execute({ sql: 'UPDATE message_cache SET flagged = ? WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [flags.flagged ? 1 : 0, mailboxId, folder, uid] });
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
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM message_cache WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [mailboxId, fromFolder, uid] });
}

export async function deleteMessage(mailboxId: number, folder: string, uid: number) {
  const client = await getClient(mailboxId);
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageDelete(`${uid}`, { uid: true });
  } finally {
    lock.release();
  }
  const db = getDb();
  await db.execute({ sql: 'DELETE FROM message_cache WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [mailboxId, folder, uid] });
}

export async function searchMessages(mailboxId: number, query: string, folder?: string) {
  const db = getDb();
  const folderClause = folder ? 'AND mc.folder = ?' : '';
  const args: (string | number)[] = [`${query}*`, mailboxId];
  if (folder) args.push(folder);

  const res = await db.execute({
    sql: `SELECT mc.* FROM message_cache mc
          INNER JOIN message_fts fts ON fts.rowid = mc.id
          WHERE message_fts MATCH ?
            AND mc.mailbox_id = ?
            ${folderClause}
          ORDER BY mc.date DESC
          LIMIT 100`,
    args,
  });
  return res.rows;
}

// --- helpers ---

type BodyPart = {
  type?: string;
  disposition?: { type?: string };
  childNodes?: BodyPart[];
};

function hasAttachmentParts(structure: BodyPart | null | undefined): boolean {
  if (!structure) return false;
  if (structure.disposition?.type?.toLowerCase() === 'attachment') return true;
  if (structure.childNodes) return structure.childNodes.some(hasAttachmentParts);
  return false;
}
