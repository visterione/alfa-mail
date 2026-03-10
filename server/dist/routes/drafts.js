import { getDb } from '../db.js';
export async function draftRoutes(app) {
    app.addHook('preHandler', app.authenticate);
    // GET /api/drafts
    app.get('/api/drafts', async (req) => {
        const user = req.user;
        const db = getDb();
        const res = await db.execute({
            sql: 'SELECT * FROM drafts WHERE user_id = ? ORDER BY updated_at DESC',
            args: [user.sub],
        });
        return res.rows;
    });
    // POST /api/drafts — create or upsert draft
    app.post('/api/drafts', async (req) => {
        const user = req.user;
        const { id, mailbox_id, to_addr, cc, bcc, subject, body, in_reply_to, references_header } = req.body;
        const db = getDb();
        if (id) {
            // Update existing draft
            await db.execute({
                sql: `UPDATE drafts SET
                mailbox_id = COALESCE(?, mailbox_id),
                to_addr = ?, cc = ?, bcc = ?, subject = ?, body = ?,
                in_reply_to = ?, references_header = ?,
                updated_at = unixepoch()
              WHERE id = ? AND user_id = ?`,
                args: [mailbox_id ?? null, to_addr ?? null, cc ?? null, bcc ?? null,
                    subject ?? null, body ?? null, in_reply_to ?? null,
                    references_header ?? null, id, user.sub],
            });
            return { ok: true, id };
        }
        // Insert new draft
        const res = await db.execute({
            sql: `INSERT INTO drafts (user_id, mailbox_id, to_addr, cc, bcc, subject, body, in_reply_to, references_header)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [user.sub, mailbox_id ?? null, to_addr ?? null, cc ?? null, bcc ?? null,
                subject ?? null, body ?? null, in_reply_to ?? null, references_header ?? null],
        });
        return { ok: true, id: Number(res.lastInsertRowid) };
    });
    // DELETE /api/drafts/:id
    app.delete('/api/drafts/:id', async (req, reply) => {
        const user = req.user;
        const { id } = req.params;
        const db = getDb();
        const res = await db.execute({
            sql: 'DELETE FROM drafts WHERE id = ? AND user_id = ?',
            args: [id, user.sub],
        });
        if (Number(res.rowsAffected) === 0)
            return reply.code(404).send({ error: 'Draft not found' });
        return { ok: true };
    });
}
