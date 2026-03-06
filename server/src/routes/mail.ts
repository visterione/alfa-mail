import type { FastifyInstance, MultipartFile } from 'fastify';
import { getDb } from '../db.js';
import {
  listFolders,
  listMessages,
  getMessage,
  syncFolder,
  setMessageFlags,
  moveMessage,
  deleteMessage,
  searchMessages,
} from '../imap.js';
import { sendMail } from '../smtp.js';

type JWTUser = { sub: number };

async function getUserMailboxIds(userId: number): Promise<number[]> {
  const db = getDb();
  const res = await db.execute({ sql: 'SELECT mailbox_id FROM user_mailboxes WHERE user_id = ?', args: [userId] });
  return res.rows.map((r) => Number(r.mailbox_id));
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
    const db = getDb();
    const res = await db.execute({
      sql: `SELECT m.id, m.email, m.display_name FROM mailboxes m
            INNER JOIN user_mailboxes um ON um.mailbox_id = m.id
            WHERE um.user_id = ?
            ORDER BY m.email`,
      args: [user.sub],
    });
    return res.rows;
  });

  // GET /api/mailboxes/:id/folders
  app.get('/api/mailboxes/:id/folders', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    syncFolder(mailboxId, 'INBOX').catch(() => {});
    return listFolders(mailboxId);
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
    await moveMessage(mailboxId, decodeURIComponent(folder), parseInt(uid, 10), to_folder);
    return { ok: true };
  });

  // DELETE /api/mailboxes/:id/folders/:folder/messages/:uid
  app.delete('/api/mailboxes/:id/folders/:folder/messages/:uid', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id, folder, uid } = req.params as { id: string; folder: string; uid: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    await deleteMessage(mailboxId, decodeURIComponent(folder), parseInt(uid, 10));
    return { ok: true };
  });

  // GET /api/mailboxes/:id/search?q=...&folder=...
  app.get('/api/mailboxes/:id/search', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const { q, folder } = req.query as { q?: string; folder?: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    if (!q || q.trim().length < 2) return reply.code(400).send({ error: 'Query too short' });
    return searchMessages(mailboxId, q.trim(), folder);
  });

  // POST /api/mailboxes/:id/send
  app.post('/api/mailboxes/:id/send', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const mailboxId = parseInt(id, 10);
    try { await assertMailboxAccess(user.sub, mailboxId); }
    catch { return reply.code(403).send({ error: 'Access denied' }); }

    const db = getDb();
    const mbRes = await db.execute({ sql: 'SELECT email, display_name FROM mailboxes WHERE id = ?', args: [mailboxId] });
    const mb = mbRes.rows[0];
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

    const { to, cc, bcc, subject, text, html, inReplyTo, references } = fields;
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
      attachments,
      inReplyTo: inReplyTo || undefined,
      references: references ? references.split(' ') : undefined,
    });

    return { ok: true };
  });
}
