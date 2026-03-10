import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { getDb, writeAudit } from '../db.js';
import {
  listFolders,
  listMessages,
  getMessage,
  syncFolder,
  setMessageFlags,
  moveMessage,
  deleteMessage,
  searchMessages,
  getUnreadCounts,
  createFolder,
  deleteFolder,
  renameFolder,
  emptyFolder,
  markAllRead,
  copyMessage,
} from '../imap.js';
import { sendMail } from '../smtp.js';
import { upsertContacts } from './contacts.js';

type JWTUser = { sub: number; username: string };

// Per-user send rate limit: max 20 sends per minute
const sendBucket = new Map<number, { count: number; resetAt: number }>();
const SEND_MAX_PER_MINUTE = 20;

function checkSendRateLimit(userId: number): boolean {
  const now = Date.now();
  let bucket = sendBucket.get(userId);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
  }
  if (bucket.count >= SEND_MAX_PER_MINUTE) return false;
  bucket.count++;
  sendBucket.set(userId, bucket);
  return true;
}

async function getUserMailboxIds(userId: number): Promise<number[]> {
  const sql = getDb();
  const rows = await sql`SELECT mailbox_id FROM user_mailboxes WHERE user_id = ${userId}`;
  return rows.map((r) => Number(r.mailbox_id));
}

async function assertMailboxAccess(userId: number, mailboxId: number) {
  const allowed = await getUserMailboxIds(userId);
  if (!allowed.includes(mailboxId)) throw new Error('Access denied');
}

export async function mailRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // GET /api/mailboxes
  app.get('/api/mailboxes', async (req) => {
    const user = req.user as JWTUser;
    const sql = getDb();
    return sql`
      SELECT m.id, m.email, m.display_name FROM mailboxes m
      INNER JOIN user_mailboxes um ON um.mailbox_id = m.id
      WHERE um.user_id = ${user.sub}
      ORDER BY m.email
    `;
  });

  // GET /api/mailboxes/:id/signature
  app.get('/api/mailboxes/:id/signature', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }
    const sql = getDb();
    const [row] = await sql`SELECT signature, signature_logo FROM mailboxes WHERE id = ${mailboxId}`;
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return { signature: row.signature ?? '', signature_logo: row.signature_logo ?? '' };
  });

  // GET /api/mailboxes/:id/folders
  app.get('/api/mailboxes/:id/folders', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    syncFolder(mailboxId, 'INBOX').catch(() => {});
    const folders = await listFolders(mailboxId);
    const unread = await getUnreadCounts(mailboxId);
    return folders.map((f) => ({ ...f, unread: unread[f.path] ?? 0 }));
  });

  // GET /api/mailboxes/:id/folders/:folder/messages
  app.get('/api/mailboxes/:id/folders/:folder/messages', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder } = req.params as { id: string; folder: string };
    const { page = '1', pageSize = '50' } = req.query as { page?: string; pageSize?: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const decodedFolder = decodeURIComponent(folder);
    syncFolder(mailboxId, decodedFolder).catch(() => {});
    return listMessages(mailboxId, decodedFolder, parseInt(page), parseInt(pageSize));
  });

  // POST /api/mailboxes/:id/folders/:folder/sync
  app.post('/api/mailboxes/:id/folders/:folder/sync', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder } = req.params as { id: string; folder: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    await syncFolder(mailboxId, decodeURIComponent(folder));
    return { ok: true };
  });

  // GET /api/mailboxes/:id/folders/:folder/messages/:uid
  app.get('/api/mailboxes/:id/folders/:folder/messages/:uid', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder, uid } = req.params as { id: string; folder: string; uid: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const decodedFolder = decodeURIComponent(folder);
    const msg = await getMessage(mailboxId, decodedFolder, parseInt(uid, 10));
    if (!msg) return reply.code(404).send({ error: 'Message not found' });

    setMessageFlags(mailboxId, decodedFolder, parseInt(uid, 10), { seen: true }).catch(() => {});

    return { uid: msg.uid, envelope: msg.envelope, source: msg.source.toString('base64') };
  });

  // PATCH /api/mailboxes/:id/folders/:folder/messages/:uid
  app.patch('/api/mailboxes/:id/folders/:folder/messages/:uid', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder, uid } = req.params as { id: string; folder: string; uid: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const { seen, flagged } = req.body as { seen?: boolean; flagged?: boolean };
    await setMessageFlags(mailboxId, decodeURIComponent(folder), parseInt(uid, 10), { seen, flagged });
    return { ok: true };
  });

  // POST /api/mailboxes/:id/folders/:folder/messages/:uid/move
  app.post('/api/mailboxes/:id/folders/:folder/messages/:uid/move', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder, uid } = req.params as { id: string; folder: string; uid: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const { to_folder } = req.body as { to_folder?: string };
    if (!to_folder) return reply.code(400).send({ error: 'to_folder required' });

    const decodedFrom = decodeURIComponent(folder);
    await moveMessage(mailboxId, decodedFrom, parseInt(uid, 10), to_folder);

    const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;
    writeAudit({ user_id: user.sub, username: user.username, action: 'move', details: `uid=${uid} from=${decodedFrom} to=${to_folder}`, ip }).catch(() => {});

    return { ok: true };
  });

  // DELETE /api/mailboxes/:id/folders/:folder/messages/:uid
  app.delete('/api/mailboxes/:id/folders/:folder/messages/:uid', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder, uid } = req.params as { id: string; folder: string; uid: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const decodedFolder = decodeURIComponent(folder);
    await deleteMessage(mailboxId, decodedFolder, parseInt(uid, 10));

    const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;
    writeAudit({ user_id: user.sub, username: user.username, action: 'delete', details: `uid=${uid} folder=${decodedFolder}`, ip }).catch(() => {});

    return { ok: true };
  });

  // POST /api/mailboxes/:id/folders — create folder
  app.post('/api/mailboxes/:id/folders', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const { path } = req.body as { path?: string };
    if (!path?.trim()) return reply.code(400).send({ error: 'path required' });
    await createFolder(mailboxId, path.trim());
    return { ok: true };
  });

  // DELETE /api/mailboxes/:id/folders/:folder — delete folder
  app.delete('/api/mailboxes/:id/folders/:folder', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder } = req.params as { id: string; folder: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    await deleteFolder(mailboxId, decodeURIComponent(folder));
    const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;
    writeAudit({ user_id: user.sub, username: user.username, action: 'delete_folder', details: `folder=${folder}`, ip }).catch(() => {});
    return { ok: true };
  });

  // PATCH /api/mailboxes/:id/folders/:folder — rename folder
  app.patch('/api/mailboxes/:id/folders/:folder', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder } = req.params as { id: string; folder: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const { new_path } = req.body as { new_path?: string };
    if (!new_path?.trim()) return reply.code(400).send({ error: 'new_path required' });
    await renameFolder(mailboxId, decodeURIComponent(folder), new_path.trim());
    return { ok: true };
  });

  // POST /api/mailboxes/:id/folders/:folder/empty — delete all messages in folder
  app.post('/api/mailboxes/:id/folders/:folder/empty', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder } = req.params as { id: string; folder: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const decodedFolder = decodeURIComponent(folder);
    await emptyFolder(mailboxId, decodedFolder);
    const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;
    writeAudit({ user_id: user.sub, username: user.username, action: 'empty_folder', details: `folder=${decodedFolder}`, ip }).catch(() => {});
    return { ok: true };
  });

  // POST /api/mailboxes/:id/folders/:folder/mark-all-read
  app.post('/api/mailboxes/:id/folders/:folder/mark-all-read', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder } = req.params as { id: string; folder: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    await markAllRead(mailboxId, decodeURIComponent(folder));
    return { ok: true };
  });

  // POST /api/mailboxes/:id/folders/:folder/messages/:uid/copy
  app.post('/api/mailboxes/:id/folders/:folder/messages/:uid/copy', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder, uid } = req.params as { id: string; folder: string; uid: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const { to_folder } = req.body as { to_folder?: string };
    if (!to_folder) return reply.code(400).send({ error: 'to_folder required' });
    await copyMessage(mailboxId, decodeURIComponent(folder), parseInt(uid, 10), to_folder);
    return { ok: true };
  });

  // GET /api/mailboxes/:id/search?q=...&folder=...&page=1&pageSize=50
  app.get('/api/mailboxes/:id/search', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const { q, folder, page = '1', pageSize = '50' } = req.query as {
      q?: string; folder?: string; page?: string; pageSize?: string;
    };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    if (!q || q.trim().length < 2) return reply.code(400).send({ error: 'Query too short' });

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 50));
    const offset = (pageNum - 1) * size;

    return searchMessages(mailboxId, q.trim(), folder, size, offset);
  });

  // POST /api/mailboxes/:id/send
  app.post('/api/mailboxes/:id/send', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    if (!checkSendRateLimit(user.sub)) {
      return reply.code(429).send({ error: 'Too many messages sent. Please wait a moment.' });
    }

    const sql = getDb();
    const [mb] = await sql`SELECT email, display_name FROM mailboxes WHERE id = ${mailboxId}`;
    if (!mb) return reply.code(404).send({ error: 'Mailbox not found' });

    const parts = req.parts();
    const fields: Record<string, string> = {};
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of (part as MultipartFile).file) chunks.push(chunk);
        attachments.push({
          filename: (part as MultipartFile).filename,
          content: Buffer.concat(chunks),
          contentType: (part as MultipartFile).mimetype,
        });
      } else {
        fields[part.fieldname] = (part as { value: string }).value;
      }
    }

    const { to, cc, bcc, subject, text, html, inReplyTo, references, signatureHtml } = fields;
    if (!to || !subject) return reply.code(400).send({ error: 'to and subject required' });

    const fromName = (mb.display_name as string | null) ?? (mb.email as string);

    await sendMail({
      mailboxId,
      from: `"${fromName}" <${mb.email}>`,
      to: to.split(',').map((s) => s.trim()),
      cc: cc ? cc.split(',').map((s) => s.trim()) : undefined,
      bcc: bcc ? bcc.split(',').map((s) => s.trim()) : undefined,
      subject,
      text: text || undefined,
      html: html || undefined,
      signatureHtml: signatureHtml || undefined,
      attachments,
      inReplyTo: inReplyTo || undefined,
      references: references ? references.split(' ') : undefined,
    });

    // Auto-collect contacts from To and CC
    const recipients: { email: string; name?: string }[] = [];
    to.split(',').map((s) => s.trim()).forEach((e) => { if (e) recipients.push({ email: e }); });
    if (cc) cc.split(',').map((s) => s.trim()).forEach((e) => { if (e) recipients.push({ email: e }); });
    upsertContacts(user.sub, recipients).catch(() => {});

    const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;
    writeAudit({ user_id: user.sub, username: user.username, action: 'send', details: `to=${to} subject=${subject}`, ip }).catch(() => {});

    return { ok: true };
  });
}
