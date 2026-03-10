import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { encrypt } from '../crypto.js';
export async function adminRoutes(app) {
    app.addHook('preHandler', app.authenticate);
    app.addHook('preHandler', async (req, reply) => {
        const user = req.user;
        if (!user.is_admin)
            return reply.code(403).send({ error: 'Admin only' });
    });
    // --- Users ---
    app.get('/api/admin/users', async () => {
        const db = getDb();
        const res = await db.execute('SELECT id, username, display_name, is_admin, created_at FROM users');
        return res.rows;
    });
    app.post('/api/admin/users', async (req, reply) => {
        const { username, password, display_name, is_admin } = req.body;
        if (!username || !password || !display_name) {
            return reply.code(400).send({ error: 'username, password, display_name required' });
        }
        const db = getDb();
        const hash = await bcrypt.hash(password, 12);
        try {
            const res = await db.execute({
                sql: 'INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)',
                args: [username, hash, display_name, is_admin ? 1 : 0],
            });
            return { id: Number(res.lastInsertRowid), username, display_name };
        }
        catch {
            return reply.code(409).send({ error: 'Username already exists' });
        }
    });
    app.put('/api/admin/users/:id', async (req, reply) => {
        const { id } = req.params;
        const { password, display_name, is_admin } = req.body;
        const db = getDb();
        const check = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [id] });
        if (!check.rows[0])
            return reply.code(404).send({ error: 'User not found' });
        if (display_name)
            await db.execute({ sql: 'UPDATE users SET display_name = ? WHERE id = ?', args: [display_name, id] });
        if (is_admin !== undefined)
            await db.execute({ sql: 'UPDATE users SET is_admin = ? WHERE id = ?', args: [is_admin ? 1 : 0, id] });
        if (password) {
            const hash = await bcrypt.hash(password, 12);
            await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hash, id] });
        }
        return { ok: true };
    });
    app.delete('/api/admin/users/:id', async (req) => {
        const { id } = req.params;
        const db = getDb();
        await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] });
        return { ok: true };
    });
    // --- Mailboxes ---
    app.get('/api/admin/mailboxes', async () => {
        const db = getDb();
        const res = await db.execute('SELECT id, email, display_name, imap_host, imap_port, smtp_host, smtp_port, created_at FROM mailboxes');
        return res.rows;
    });
    app.post('/api/admin/mailboxes', async (req, reply) => {
        const { email, display_name, password, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, } = req.body;
        if (!email || !password || !imap_host || !smtp_host) {
            return reply.code(400).send({ error: 'email, password, imap_host, smtp_host required' });
        }
        const db = getDb();
        const password_enc = encrypt(password);
        try {
            const res = await db.execute({
                sql: `INSERT INTO mailboxes (email, display_name, password_enc, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    email, display_name ?? email, password_enc,
                    imap_host, imap_port ?? 993, imap_secure !== false ? 1 : 0,
                    smtp_host, smtp_port ?? 587, smtp_secure ? 1 : 0,
                ],
            });
            return { id: Number(res.lastInsertRowid), email };
        }
        catch {
            return reply.code(409).send({ error: 'Mailbox already exists' });
        }
    });
    app.delete('/api/admin/mailboxes/:id', async (req) => {
        const { id } = req.params;
        const db = getDb();
        await db.execute({ sql: 'DELETE FROM mailboxes WHERE id = ?', args: [id] });
        return { ok: true };
    });
    // --- User-Mailbox assignments ---
    app.get('/api/admin/users/:id/mailboxes', async (req, reply) => {
        const { id } = req.params;
        const db = getDb();
        const check = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [id] });
        if (!check.rows[0])
            return reply.code(404).send({ error: 'User not found' });
        const res = await db.execute({
            sql: `SELECT m.id, m.email, m.display_name FROM mailboxes m
            INNER JOIN user_mailboxes um ON um.mailbox_id = m.id
            WHERE um.user_id = ?`,
            args: [id],
        });
        return res.rows;
    });
    app.post('/api/admin/users/:id/mailboxes', async (req, reply) => {
        const { id } = req.params;
        const { mailbox_id } = req.body;
        if (!mailbox_id)
            return reply.code(400).send({ error: 'mailbox_id required' });
        const db = getDb();
        try {
            await db.execute({ sql: 'INSERT INTO user_mailboxes (user_id, mailbox_id) VALUES (?, ?)', args: [id, mailbox_id] });
            return { ok: true };
        }
        catch {
            return reply.code(409).send({ error: 'Assignment already exists' });
        }
    });
    app.delete('/api/admin/users/:id/mailboxes/:mailbox_id', async (req) => {
        const { id, mailbox_id } = req.params;
        const db = getDb();
        await db.execute({ sql: 'DELETE FROM user_mailboxes WHERE user_id = ? AND mailbox_id = ?', args: [id, mailbox_id] });
        return { ok: true };
    });
    // --- Audit Log ---
    app.get('/api/admin/audit-log', async (req) => {
        const { limit = '100', offset = '0', action } = req.query;
        const db = getDb();
        const filterArgs = [];
        let where = '';
        if (action) {
            where = 'WHERE action = ?';
            filterArgs.push(action);
        }
        const res = await db.execute({
            sql: `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            args: [...filterArgs, parseInt(limit, 10), parseInt(offset, 10)],
        });
        const countRes = await db.execute({
            sql: `SELECT COUNT(*) as c FROM audit_log ${where}`,
            args: filterArgs,
        });
        return { total: Number(countRes.rows[0]?.c ?? 0), entries: res.rows };
    });
}
