import bcrypt from 'bcryptjs';
import { getDb, writeAudit } from '../db.js';
export async function authRoutes(app) {
    // POST /api/auth/setup — create first admin (only works when no users exist)
    app.post('/api/auth/setup', async (req, reply) => {
        const db = getDb();
        const res = await db.execute('SELECT COUNT(*) as c FROM users');
        const count = Number(res.rows[0]?.c ?? 0);
        if (count > 0)
            return reply.code(403).send({ error: 'Setup already done' });
        const { username, password, display_name } = req.body;
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
        const { username, password } = req.body;
        if (!username || !password)
            return reply.code(400).send({ error: 'username and password required' });
        const db = getDb();
        const res = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
        const user = res.rows[0];
        const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;
        if (!user) {
            await writeAudit({ username, action: 'login_failed', details: 'user not found', ip });
            return reply.code(401).send({ error: 'Invalid credentials' });
        }
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            await writeAudit({ user_id: Number(user.id), username, action: 'login_failed', details: 'wrong password', ip });
            return reply.code(401).send({ error: 'Invalid credentials' });
        }
        await writeAudit({ user_id: Number(user.id), username, action: 'login', ip });
        const token = app.jwt.sign({
            sub: Number(user.id),
            username: user.username,
            display_name: user.display_name,
            is_admin: user.is_admin,
        }, { expiresIn: '7d' });
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
    // GET /api/auth/settings — get current user settings (signature)
    app.get('/api/auth/settings', { preHandler: [app.authenticate] }, async (req) => {
        const user = req.user;
        const db = getDb();
        const res = await db.execute({ sql: 'SELECT * FROM user_settings WHERE user_id = ?', args: [user.sub] });
        if (!res.rows[0])
            return { signature: '' };
        return { signature: res.rows[0].signature ?? '' };
    });
    // PUT /api/auth/settings — save signature
    app.put('/api/auth/settings', { preHandler: [app.authenticate] }, async (req) => {
        const user = req.user;
        const { signature } = req.body;
        const db = getDb();
        await db.execute({
            sql: `INSERT INTO user_settings (user_id, signature, updated_at)
            VALUES (?, ?, unixepoch())
            ON CONFLICT(user_id) DO UPDATE SET signature = excluded.signature, updated_at = excluded.updated_at`,
            args: [user.sub, signature ?? ''],
        });
        return { ok: true };
    });
    // PUT /api/auth/password — change own password
    app.put('/api/auth/password', { preHandler: [app.authenticate] }, async (req, reply) => {
        const user = req.user;
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return reply.code(400).send({ error: 'current_password and new_password required' });
        }
        if (new_password.length < 6) {
            return reply.code(400).send({ error: 'new_password must be at least 6 characters' });
        }
        const db = getDb();
        const res = await db.execute({ sql: 'SELECT password_hash FROM users WHERE id = ?', args: [user.sub] });
        const row = res.rows[0];
        if (!row)
            return reply.code(404).send({ error: 'User not found' });
        const valid = await bcrypt.compare(current_password, row.password_hash);
        if (!valid)
            return reply.code(401).send({ error: 'Current password is incorrect' });
        const hash = await bcrypt.hash(new_password, 12);
        await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, user.sub] });
        const ip = req.headers['x-forwarded-for']?.toString() ?? req.ip;
        await writeAudit({ user_id: user.sub, username: user.username, action: 'password_changed', ip });
        return { ok: true };
    });
}
