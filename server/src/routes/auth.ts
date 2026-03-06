import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/setup — create first admin (only works when no users exist)
  app.post('/api/auth/setup', async (req, reply) => {
    const db = getDb();
    const res = await db.execute('SELECT COUNT(*) as c FROM users');
    const count = Number(res.rows[0]?.c ?? 0);
    if (count > 0) return reply.code(403).send({ error: 'Setup already done' });

    const { username, password, display_name } = req.body as {
      username?: string;
      password?: string;
      display_name?: string;
    };

    if (!username || !password || !display_name) {
      return reply.code(400).send({ error: 'username, password, display_name required' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await db.execute({
      sql: 'INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, 1)',
      args: [username, hash, display_name],
    });

    return { id: Number(result.lastInsertRowid), username, display_name };
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) return reply.code(400).send({ error: 'username and password required' });

    const db = getDb();
    const res = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
    const user = res.rows[0];
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash as string);
    if (!valid) return reply.code(401).send({ error: 'Invalid credentials' });

    const token = app.jwt.sign(
      {
        sub: Number(user.id),
        username: user.username,
        display_name: user.display_name,
        is_admin: user.is_admin,
      },
      { expiresIn: '7d' }
    );

    return {
      token,
      user: {
        id: Number(user.id),
        username: user.username,
        display_name: user.display_name,
        is_admin: user.is_admin,
      },
    };
  });

  // GET /api/auth/me
  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return req.user;
  });
}
