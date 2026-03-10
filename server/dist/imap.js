import { ImapFlow } from 'imapflow';
import { getDb } from './db.js';
import { decrypt } from './crypto.js';
// Connection pool: mailboxId -> ImapFlow instance
const pool = new Map();
// Tracks which folders are currently being synced
const syncLocks = new Set();
// Tracks background full-sync progress: key -> { done, total }
const fullSyncProgress = new Map();
// ─── Connection pool ──────────────────────────────────────────────────────────
async function getMailbox(mailboxId) {
    const db = getDb();
    const res = await db.execute({ sql: 'SELECT * FROM mailboxes WHERE id = ?', args: [mailboxId] });
    if (!res.rows[0])
        throw new Error('Mailbox not found');
    return res.rows[0];
}
function buildClientOptions(mb) {
    return {
        host: mb.imap_host,
        port: mb.imap_port,
        secure: mb.imap_secure === 1,
        auth: { user: mb.email, pass: decrypt(mb.password_enc) },
        logger: false,
        tls: { rejectUnauthorized: false },
    };
}
export async function getClient(mailboxId) {
    let client = pool.get(mailboxId);
    if (client && client.usable)
        return client;
    const mb = await getMailbox(mailboxId);
    client = new ImapFlow(buildClientOptions(mb));
    await client.connect();
    pool.set(mailboxId, client);
    client.on('close', () => pool.delete(mailboxId));
    client.on('error', () => pool.delete(mailboxId));
    return client;
}
// ─── Public API ───────────────────────────────────────────────────────────────
export async function listFolders(mailboxId) {
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
// Returns unread counts per folder from the local cache
export async function getUnreadCounts(mailboxId) {
    const db = getDb();
    const res = await db.execute({
        sql: `SELECT folder, COUNT(*) as cnt FROM message_cache
          WHERE mailbox_id = ? AND seen = 0
          GROUP BY folder`,
        args: [mailboxId],
    });
    const result = {};
    for (const row of res.rows) {
        result[row.folder] = Number(row.cnt);
    }
    return result;
}
export async function listMessages(mailboxId, folder, page, pageSize) {
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
          ORDER BY date DESC LIMIT ? OFFSET ?`,
        args: [mailboxId, folder, pageSize, offset],
    });
    const progressKey = `${mailboxId}:${folder}`;
    const progress = fullSyncProgress.get(progressKey) ?? null;
    return { total, messages: msgsRes.rows, syncProgress: progress };
}
export async function getMessage(mailboxId, folder, uid) {
    const client = await getClient(mailboxId);
    let result = null;
    const lock = await client.getMailboxLock(folder);
    try {
        for await (const msg of client.fetch(`${uid}`, { uid: true, source: true, envelope: true, bodyStructure: true }, { uid: true })) {
            result = { uid: msg.uid, source: msg.source, envelope: msg.envelope };
        }
    }
    finally {
        lock.release();
    }
    return result;
}
/**
 * Trigger sync for a folder.
 * - First call (no cache): quickly loads last 500 messages, then syncs the rest in background.
 * - Subsequent calls: loads only new messages since last sync.
 */
export async function syncFolder(mailboxId, folder) {
    const lockKey = `${mailboxId}:${folder}`;
    if (syncLocks.has(lockKey))
        return;
    syncLocks.add(lockKey);
    try {
        const db = getDb();
        const client = await getClient(mailboxId);
        const lock = await client.getMailboxLock(folder);
        try {
            const stateRes = await db.execute({
                sql: 'SELECT last_uid, full_sync_done FROM sync_state WHERE mailbox_id = ? AND folder = ?',
                args: [mailboxId, folder],
            });
            const state = stateRes.rows[0];
            const lastUid = Number(state?.last_uid ?? 0);
            const fullSyncDone = Number(state?.full_sync_done ?? 0) === 1;
            const mailboxInfo = client.mailbox;
            const totalExists = mailboxInfo?.exists ?? 0;
            if (lastUid === 0 && totalExists > 0) {
                // ── FIRST SYNC: Phase 1 — fetch last 500 by sequence number ──────────
                const startSeq = Math.max(1, totalExists - 499);
                const rows = [];
                let maxUid = 0;
                for await (const msg of client.fetch(`${startSeq}:*`, {
                    uid: true, envelope: true, flags: true, bodyStructure: true, size: true,
                })) {
                    if (msg.uid > maxUid)
                        maxUid = msg.uid;
                    rows.push(buildRow(mailboxId, folder, msg));
                    if (rows.length >= 200)
                        await batchInsert(rows.splice(0));
                }
                if (rows.length > 0)
                    await batchInsert(rows);
                if (maxUid > 0) {
                    await upsertState(mailboxId, folder, maxUid, startSeq <= 1 ? 1 : 0);
                }
                // Apply rules to newly inserted messages
                await applyRulesToFolder(mailboxId, folder, rows).catch(() => { });
                // Phase 2 — sync older messages in background (don't block the response)
                if (startSeq > 1) {
                    lock.release();
                    syncLocks.delete(lockKey);
                    syncOlderMessages(mailboxId, folder, maxUid, startSeq - 1).catch(() => { });
                    return;
                }
            }
            else {
                // ── INCREMENTAL SYNC: only fetch new messages ──────────────────────
                if (totalExists === 0)
                    return;
                const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';
                const rows = [];
                let maxUid = lastUid;
                for await (const msg of client.fetch(range, {
                    uid: true, envelope: true, flags: true, bodyStructure: true, size: true,
                }, { uid: true })) {
                    if (msg.uid <= lastUid)
                        continue;
                    if (msg.uid > maxUid)
                        maxUid = msg.uid;
                    rows.push(buildRow(mailboxId, folder, msg));
                    if (rows.length >= 200)
                        await batchInsert(rows.splice(0));
                }
                if (rows.length > 0)
                    await batchInsert(rows);
                if (maxUid > lastUid) {
                    await upsertState(mailboxId, folder, maxUid, fullSyncDone ? 1 : 0);
                    // Apply rules to new messages only
                    await applyRulesToFolder(mailboxId, folder, rows).catch(() => { });
                }
            }
        }
        finally {
            lock.release();
        }
    }
    finally {
        syncLocks.delete(lockKey);
    }
}
/**
 * Background task: sync messages older than what was loaded in Phase 1.
 * Fetches sequence 1..maxSeq in chunks of 500, newest first (descending seq).
 */
async function syncOlderMessages(mailboxId, folder, knownMaxUid, maxSeq) {
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
            const rows = [];
            try {
                for await (const msg of client.fetch(`${seqStart}:${seqEnd}`, {
                    uid: true, envelope: true, flags: true, bodyStructure: true, size: true,
                })) {
                    if (msg.uid >= knownMaxUid)
                        continue; // already have these
                    rows.push(buildRow(mailboxId, folder, msg));
                    if (rows.length >= 200)
                        await batchInsert(rows.splice(0));
                }
                if (rows.length > 0)
                    await batchInsert(rows);
            }
            finally {
                lock.release();
            }
            totalDone += (seqEnd - seqStart + 1);
            fullSyncProgress.set(progressKey, { done: totalDone, total: maxSeq });
            seqEnd = seqStart - 1;
        }
        // Mark full sync as done, record the overall max UID
        const db = getDb();
        await db.execute({
            sql: `UPDATE sync_state SET full_sync_done = 1 WHERE mailbox_id = ? AND folder = ?`,
            args: [mailboxId, folder],
        });
    }
    finally {
        fullSyncProgress.delete(progressKey);
    }
}
export async function setMessageFlags(mailboxId, folder, uid, flags) {
    const client = await getClient(mailboxId);
    const lock = await client.getMailboxLock(folder);
    try {
        if (flags.seen !== undefined) {
            if (flags.seen)
                await client.messageFlagsAdd(`${uid}`, ['\\Seen'], { uid: true });
            else
                await client.messageFlagsRemove(`${uid}`, ['\\Seen'], { uid: true });
        }
        if (flags.flagged !== undefined) {
            if (flags.flagged)
                await client.messageFlagsAdd(`${uid}`, ['\\Flagged'], { uid: true });
            else
                await client.messageFlagsRemove(`${uid}`, ['\\Flagged'], { uid: true });
        }
    }
    finally {
        lock.release();
    }
    const db = getDb();
    if (flags.seen !== undefined) {
        await db.execute({ sql: 'UPDATE message_cache SET seen = ? WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [flags.seen ? 1 : 0, mailboxId, folder, uid] });
    }
    if (flags.flagged !== undefined) {
        await db.execute({ sql: 'UPDATE message_cache SET flagged = ? WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [flags.flagged ? 1 : 0, mailboxId, folder, uid] });
    }
}
export async function moveMessage(mailboxId, fromFolder, uid, toFolder) {
    const client = await getClient(mailboxId);
    const lock = await client.getMailboxLock(fromFolder);
    try {
        await client.messageMove(`${uid}`, toFolder, { uid: true });
    }
    finally {
        lock.release();
    }
    const db = getDb();
    await db.execute({ sql: 'DELETE FROM message_cache WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [mailboxId, fromFolder, uid] });
}
export async function deleteMessage(mailboxId, folder, uid) {
    const client = await getClient(mailboxId);
    const lock = await client.getMailboxLock(folder);
    try {
        await client.messageDelete(`${uid}`, { uid: true });
    }
    finally {
        lock.release();
    }
    const db = getDb();
    await db.execute({ sql: 'DELETE FROM message_cache WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [mailboxId, folder, uid] });
}
export async function searchMessages(mailboxId, query, folder) {
    const db = getDb();
    const folderClause = folder ? 'AND mc.folder = ?' : '';
    const args = [`${query}*`, mailboxId];
    if (folder)
        args.push(folder);
    const res = await db.execute({
        sql: `SELECT mc.* FROM message_cache mc
          INNER JOIN message_fts fts ON fts.rowid = mc.id
          WHERE message_fts MATCH ? AND mc.mailbox_id = ? ${folderClause}
          ORDER BY mc.date DESC LIMIT 100`,
        args,
    });
    return res.rows;
}
// ─── Email Rules ──────────────────────────────────────────────────────────────
async function applyRulesToFolder(mailboxId, folder, rows) {
    if (rows.length === 0)
        return;
    const db = getDb();
    const rulesRes = await db.execute({
        sql: 'SELECT * FROM email_rules WHERE mailbox_id = ? AND active = 1 ORDER BY priority, id',
        args: [mailboxId],
    });
    const rules = rulesRes.rows;
    if (rules.length === 0)
        return;
    const client = await getClient(mailboxId);
    for (const row of rows) {
        for (const rule of rules) {
            if (!matchesRule(row, rule))
                continue;
            try {
                if (rule.action === 'mark_read') {
                    await setMessageFlags(mailboxId, folder, row.uid, { seen: true });
                }
                else if (rule.action === 'flag') {
                    await setMessageFlags(mailboxId, folder, row.uid, { flagged: true });
                }
                else if (rule.action === 'move' && rule.action_param) {
                    const lock = await client.getMailboxLock(folder);
                    try {
                        await client.messageMove(`${row.uid}`, rule.action_param, { uid: true });
                    }
                    finally {
                        lock.release();
                    }
                    await db.execute({ sql: 'DELETE FROM message_cache WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [mailboxId, folder, row.uid] });
                    break; // after move, stop applying more rules to this message
                }
                else if (rule.action === 'delete') {
                    const lock = await client.getMailboxLock(folder);
                    try {
                        await client.messageDelete(`${row.uid}`, { uid: true });
                    }
                    finally {
                        lock.release();
                    }
                    await db.execute({ sql: 'DELETE FROM message_cache WHERE mailbox_id = ? AND folder = ? AND uid = ?', args: [mailboxId, folder, row.uid] });
                    break; // deleted, stop
                }
            }
            catch {
                // Rule application errors are non-fatal
            }
        }
    }
}
function matchesRule(row, rule) {
    const val = rule.condition_value.toLowerCase();
    let fieldValue = '';
    switch (rule.condition_field) {
        case 'from':
            fieldValue = (row.from_addr ?? '') + ' ' + (row.from_name ?? '');
            break;
        case 'to':
            fieldValue = row.to_addrs ?? '';
            break;
        case 'subject':
            fieldValue = row.subject ?? '';
            break;
        case 'any':
            fieldValue = [(row.from_addr ?? ''), (row.from_name ?? ''), (row.subject ?? ''), (row.to_addrs ?? '')].join(' ');
            break;
        default: return false;
    }
    fieldValue = fieldValue.toLowerCase();
    if (rule.condition_op === 'contains')
        return fieldValue.includes(val);
    if (rule.condition_op === 'equals')
        return fieldValue.trim() === val;
    return false;
}
function normalizeSubject(subject) {
    if (!subject)
        return '';
    return subject.replace(/^(Re|Fwd|Fw|Ответ|Пересылка):\s*/gi, '').trim().toLowerCase();
}
function buildRow(mailboxId, folder, msg) {
    const from = msg.envelope?.from?.[0];
    const flags = msg.flags ?? new Set();
    const inReplyTo = msg.envelope?.inReplyTo ?? null;
    const messageId = msg.envelope?.messageId ?? null;
    // Thread ID: prefer In-Reply-To chain, fall back to normalized subject
    const threadId = inReplyTo ?? messageId ?? normalizeSubject(msg.envelope?.subject ?? null);
    return {
        mailbox_id: mailboxId,
        folder,
        uid: msg.uid,
        message_id: messageId,
        in_reply_to: inReplyTo,
        thread_id: threadId || null,
        from_addr: from?.address ?? null,
        from_name: from?.name ?? null,
        to_addrs: JSON.stringify((msg.envelope?.to ?? []).map((a) => a.address)),
        cc_addrs: JSON.stringify((msg.envelope?.cc ?? []).map((a) => ({ address: a.address, name: a.name }))),
        subject: msg.envelope?.subject ?? null,
        date: msg.envelope?.date ? Math.floor(new Date(msg.envelope.date).getTime() / 1000) : null,
        has_attachments: hasAttachmentParts(msg.bodyStructure) ? 1 : 0,
        seen: flags.has('\\Seen') ? 1 : 0,
        flagged: flags.has('\\Flagged') ? 1 : 0,
        size: msg.size ?? null,
    };
}
async function batchInsert(rows) {
    const db = getDb();
    await db.batch(rows.map((r) => ({
        sql: `INSERT OR REPLACE INTO message_cache
            (mailbox_id, folder, uid, message_id, in_reply_to, thread_id,
             from_addr, from_name, to_addrs, cc_addrs, subject, date, has_attachments, seen, flagged, size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.mailbox_id, r.folder, r.uid, r.message_id, r.in_reply_to, r.thread_id,
            r.from_addr, r.from_name, r.to_addrs, r.cc_addrs, r.subject, r.date,
            r.has_attachments, r.seen, r.flagged, r.size],
    })), 'write');
}
async function upsertState(mailboxId, folder, lastUid, fullSyncDone) {
    const db = getDb();
    await db.execute({
        sql: `INSERT INTO sync_state (mailbox_id, folder, last_uid, full_sync_done, last_synced)
          VALUES (?, ?, ?, ?, unixepoch())
          ON CONFLICT(mailbox_id, folder) DO UPDATE SET
            last_uid = MAX(last_uid, excluded.last_uid),
            full_sync_done = MAX(full_sync_done, excluded.full_sync_done),
            last_synced = excluded.last_synced`,
        args: [mailboxId, folder, lastUid, fullSyncDone],
    });
}
function hasAttachmentParts(structure) {
    if (!structure)
        return false;
    if (structure.disposition?.type?.toLowerCase() === 'attachment')
        return true;
    if (structure.childNodes)
        return structure.childNodes.some(hasAttachmentParts);
    return false;
}
