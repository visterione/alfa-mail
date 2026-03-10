import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { encrypt } from '../crypto.js';

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', async (req, reply) => {
    const user = req.user as { is_admin: number };
    if (!user.is_admin) return reply.code(403).send({ error: 'Admin only' });
  });

  // --- Users ---

  app.get('/api/admin/users', async () => {
    const sql = getDb();
    return sql`SELECT id, username, display_name, is_admin, created_at FROM users`;
  });

  app.post('/api/admin/users', async (req, reply) => {
    const { username, password, display_name, is_admin } = req.body as {
      username?: string; password?: string; display_name?: string; is_admin?: boolean;
    };
    if (!username || !password || !display_name) {
      return reply.code(400).send({ error: 'username, password, display_name required' });
    }

    const sql = getDb();
    const hash = await bcrypt.hash(password, 12);
    try {
      const [row] = await sql`
        INSERT INTO users (username, password_hash, display_name, is_admin)
        VALUES (${username}, ${hash}, ${display_name}, ${is_admin ? 1 : 0})
        RETURNING id
      `;
      return { id: Number(row.id), username, display_name };
    } catch {
      return reply.code(409).send({ error: 'Username already exists' });
    }
  });

  app.put('/api/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { password, display_name, is_admin } = req.body as {
      password?: string; display_name?: string; is_admin?: boolean;
    };

    const sql = getDb();
    const [check] = await sql`SELECT id FROM users WHERE id = ${id}`;
    if (!check) return reply.code(404).send({ error: 'User not found' });

    if (display_name !== undefined) await sql`UPDATE users SET display_name = ${display_name} WHERE id = ${id}`;
    if (is_admin    !== undefined) await sql`UPDATE users SET is_admin = ${is_admin ? 1 : 0} WHERE id = ${id}`;
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${id}`;
    }

    return { ok: true };
  });

  app.delete('/api/admin/users/:id', async (req) => {
    const { id } = req.params as { id: string };
    const sql = getDb();
    await sql`DELETE FROM users WHERE id = ${id}`;
    return { ok: true };
  });

  // --- Mailboxes ---

  app.get('/api/admin/mailboxes', async () => {
    const sql = getDb();
    return sql`SELECT id, email, display_name, imap_host, imap_port, smtp_host, smtp_port, created_at FROM mailboxes`;
  });

  app.post('/api/admin/mailboxes', async (req, reply) => {
    const {
      email, display_name, password,
      imap_host, imap_port, imap_secure,
      smtp_host, smtp_port, smtp_secure,
    } = req.body as {
      email?: string; display_name?: string; password?: string;
      imap_host?: string; imap_port?: number; imap_secure?: boolean;
      smtp_host?: string; smtp_port?: number; smtp_secure?: boolean;
    };

    if (!email || !password || !imap_host || !smtp_host) {
      return reply.code(400).send({ error: 'email, password, imap_host, smtp_host required' });
    }

    const sql = getDb();
    const password_enc = encrypt(password);

    try {
      const [row] = await sql`
        INSERT INTO mailboxes (email, display_name, password_enc, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure)
        VALUES (
          ${email}, ${display_name ?? email}, ${password_enc},
          ${imap_host}, ${imap_port ?? 993}, ${imap_secure !== false ? 1 : 0},
          ${smtp_host}, ${smtp_port ?? 587}, ${smtp_secure ? 1 : 0}
        )
        RETURNING id
      `;
      return { id: Number(row.id), email };
    } catch {
      return reply.code(409).send({ error: 'Mailbox already exists' });
    }
  });

  app.delete('/api/admin/mailboxes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const sql = getDb();
    await sql`DELETE FROM mailboxes WHERE id = ${id}`;
    return { ok: true };
  });

  app.get('/api/admin/mailboxes/:id/signature', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sql = getDb();
    const [row] = await sql`SELECT signature, signature_logo FROM mailboxes WHERE id = ${id}`;
    if (!row) return reply.code(404).send({ error: 'Mailbox not found' });
    return { signature: row.signature ?? '', signature_logo: row.signature_logo ?? '' };
  });

  app.put('/api/admin/mailboxes/:id/signature', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { signature, signature_logo } = req.body as { signature?: string; signature_logo?: string };
    const sql = getDb();
    const [check] = await sql`SELECT id FROM mailboxes WHERE id = ${id}`;
    if (!check) return reply.code(404).send({ error: 'Mailbox not found' });
    await sql`UPDATE mailboxes SET signature = ${signature ?? ''}, signature_logo = ${signature_logo ?? ''} WHERE id = ${id}`;
    return { ok: true };
  });

  // --- User-Mailbox assignments ---

  app.get('/api/admin/users/:id/mailboxes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sql = getDb();
    const [check] = await sql`SELECT id FROM users WHERE id = ${id}`;
    if (!check) return reply.code(404).send({ error: 'User not found' });

    return sql`
      SELECT m.id, m.email, m.display_name FROM mailboxes m
      INNER JOIN user_mailboxes um ON um.mailbox_id = m.id
      WHERE um.user_id = ${id}
    `;
  });

  app.post('/api/admin/users/:id/mailboxes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { mailbox_id } = req.body as { mailbox_id?: number };
    if (!mailbox_id) return reply.code(400).send({ error: 'mailbox_id required' });

    const sql = getDb();
    try {
      await sql`INSERT INTO user_mailboxes (user_id, mailbox_id) VALUES (${id}, ${mailbox_id})`;
      return { ok: true };
    } catch {
      return reply.code(409).send({ error: 'Assignment already exists' });
    }
  });

  app.delete('/api/admin/users/:id/mailboxes/:mailbox_id', async (req) => {
    const { id, mailbox_id } = req.params as { id: string; mailbox_id: string };
    const sql = getDb();
    await sql`DELETE FROM user_mailboxes WHERE user_id = ${id} AND mailbox_id = ${mailbox_id}`;
    return { ok: true };
  });

  // --- Audit Log ---

  app.get('/api/admin/audit-log', async (req) => {
    const { limit = '100', offset = '0', action } = req.query as {
      limit?: string; offset?: string; action?: string;
    };
    const sql = getDb();

    const actionFilter = action ? sql`AND action = ${action}` : sql``;

    const [{ c }] = await sql`
      SELECT COUNT(*) as c FROM audit_log WHERE 1=1 ${actionFilter}
    `;
    const entries = await sql`
      SELECT * FROM audit_log WHERE 1=1 ${actionFilter}
      ORDER BY created_at DESC
      LIMIT ${parseInt(limit, 10)} OFFSET ${parseInt(offset, 10)}
    `;

    return { total: Number(c), entries };
  });
}
