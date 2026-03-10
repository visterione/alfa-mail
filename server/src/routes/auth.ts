import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { getDb, writeAudit } from '../db.js';

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/setup — create first admin (only works when no users exist)
  app.post('/api/auth/setup', async (req, reply) => {
    const sql = getDb();
    const [{ c }] = await sql`SELECT COUNT(*) as c FROM users`;
    if (Number(c) > 0) return reply.code(403).send({ error: 'Setup already done' });

    const { username, password, display_name } = req.body as {
      username?: string;
      password?: string;
      display_name?: string;
    };

    if (!username || !password || !display_name) {
      return reply.code(400).send({ error: 'username, password, display_name required' });
    }

    const hash = await bcrypt.hash(password, 12);
    const [row] = await sql`
      INSERT INTO users (username, password_hash, display_name, is_admin)
      VALUES (${username}, ${hash}, ${display_name}, 1)
      RETURNING id
    `;

    return { id: Number(row.id), username, display_name };
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) return reply.code(400).send({ error: 'username and password required' });

    const sql = getDb();
    const [user] = await sql`SELECT * FROM users WHERE username = ${username}`;
    const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;

    if (!user) {
      await writeAudit({ username, action: 'login_failed', details: 'user not found', ip });
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash as string);
    if (!valid) {
      await writeAudit({ user_id: Number(user.id), username, action: 'login_failed', details: 'wrong password', ip });
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    await writeAudit({ user_id: Number(user.id), username, action: 'login', ip });

    const token = app.jwt.sign(
      { sub: Number(user.id), username: user.username, display_name: user.display_name, is_admin: user.is_admin },
      { expiresIn: '7d' }
    );

    return {
      token,
      user: { id: Number(user.id), username: user.username, display_name: user.display_name, is_admin: user.is_admin },
    };
  });

  // GET /api/auth/me
  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return req.user;
  });

  // GET /api/auth/settings
  app.get('/api/auth/settings', { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: number };
    const sql = getDb();
    const [row] = await sql`SELECT * FROM user_settings WHERE user_id = ${user.sub}`;
    if (!row) return { signature: '', signature_logo: '' };
    return { signature: row.signature ?? '', signature_logo: row.signature_logo ?? '' };
  });

  // PUT /api/auth/settings
  app.put('/api/auth/settings', { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user as { sub: number };
    const { signature, signature_logo } = req.body as { signature?: string; signature_logo?: string };
    const sql = getDb();
    await sql`
      INSERT INTO user_settings (user_id, signature, signature_logo, updated_at)
      VALUES (${user.sub}, ${signature ?? ''}, ${signature_logo ?? ''}, EXTRACT(EPOCH FROM NOW())::INTEGER)
      ON CONFLICT (user_id) DO UPDATE SET
        signature      = EXCLUDED.signature,
        signature_logo = EXCLUDED.signature_logo,
        updated_at     = EXCLUDED.updated_at
    `;
    return { ok: true };
  });

  // PUT /api/auth/password
  app.put('/api/auth/password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub: number; username: string };
    const { current_password, new_password } = req.body as { current_password?: string; new_password?: string };
    if (!current_password || !new_password) {
      return reply.code(400).send({ error: 'current_password and new_password required' });
    }
    if (new_password.length < 6) {
      return reply.code(400).send({ error: 'new_password must be at least 6 characters' });
    }

    const sql = getDb();
    const [row] = await sql`SELECT password_hash FROM users WHERE id = ${user.sub}`;
    if (!row) return reply.code(404).send({ error: 'User not found' });

    const valid = await bcrypt.compare(current_password, row.password_hash as string);
    if (!valid) return reply.code(401).send({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.sub}`;

    const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;
    await writeAudit({ user_id: user.sub, username: user.username, action: 'password_changed', ip });

    return { ok: true };
  });
}
