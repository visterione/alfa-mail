import { getDb } from '../db.js';
async function getUserMailboxIds(userId) {
    const db = getDb();
    const res = await db.execute({ sql: 'SELECT mailbox_id FROM user_mailboxes WHERE user_id = ?', args: [userId] });
    return res.rows.map((r) => Number(r.mailbox_id));
}
export async function ruleRoutes(app) {
    app.addHook('preHandler', app.authenticate);
    // GET /api/rules?mailbox_id=1
    app.get('/api/rules', async (req, reply) => {
        const user = req.user;
        const { mailbox_id } = req.query;
        if (!mailbox_id)
            return reply.code(400).send({ error: 'mailbox_id required' });
        const mbId = parseInt(mailbox_id, 10);
        const allowed = await getUserMailboxIds(user.sub);
        if (!allowed.includes(mbId))
            return reply.code(403).send({ error: 'Access denied' });
        const db = getDb();
        const res = await db.execute({
            sql: 'SELECT * FROM email_rules WHERE mailbox_id = ? ORDER BY priority, id',
            args: [mbId],
        });
        return res.rows;
    });
    // POST /api/rules
    app.post('/api/rules', async (req, reply) => {
        const user = req.user;
        const { mailbox_id, name, condition_field, condition_op, condition_value, action, action_param, priority } = req.body;
        if (!mailbox_id || !name || !condition_field || !condition_op || !condition_value || !action) {
            return reply.code(400).send({ error: 'mailbox_id, name, condition_field, condition_op, condition_value, action required' });
        }
        const validFields = ['from', 'to', 'subject', 'any'];
        const validOps = ['contains', 'equals'];
        const validActions = ['move', 'flag', 'mark_read', 'delete'];
        if (!validFields.includes(condition_field))
            return reply.code(400).send({ error: 'Invalid condition_field' });
        if (!validOps.includes(condition_op))
            return reply.code(400).send({ error: 'Invalid condition_op' });
        if (!validActions.includes(action))
            return reply.code(400).send({ error: 'Invalid action' });
        if (action === 'move' && !action_param)
            return reply.code(400).send({ error: 'action_param (folder) required for move action' });
        const allowed = await getUserMailboxIds(user.sub);
        if (!allowed.includes(mailbox_id))
            return reply.code(403).send({ error: 'Access denied' });
        const db = getDb();
        const res = await db.execute({
            sql: `INSERT INTO email_rules (mailbox_id, name, condition_field, condition_op, condition_value, action, action_param, priority)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [mailbox_id, name, condition_field, condition_op, condition_value, action, action_param ?? null, priority ?? 0],
        });
        return { ok: true, id: Number(res.lastInsertRowid) };
    });
    // PATCH /api/rules/:id — toggle active
    app.patch('/api/rules/:id', async (req, reply) => {
        const user = req.user;
        const { id } = req.params;
        const { active } = req.body;
        const db = getDb();
        // Verify ownership via mailbox assignment
        const ruleRes = await db.execute({ sql: 'SELECT mailbox_id FROM email_rules WHERE id = ?', args: [id] });
        const rule = ruleRes.rows[0];
        if (!rule)
            return reply.code(404).send({ error: 'Rule not found' });
        const allowed = await getUserMailboxIds(user.sub);
        if (!allowed.includes(Number(rule.mailbox_id)))
            return reply.code(403).send({ error: 'Access denied' });
        await db.execute({ sql: 'UPDATE email_rules SET active = ? WHERE id = ?', args: [active ? 1 : 0, id] });
        return { ok: true };
    });
    // DELETE /api/rules/:id
    app.delete('/api/rules/:id', async (req, reply) => {
        const user = req.user;
        const { id } = req.params;
        const db = getDb();
        const ruleRes = await db.execute({ sql: 'SELECT mailbox_id FROM email_rules WHERE id = ?', args: [id] });
        const rule = ruleRes.rows[0];
        if (!rule)
            return reply.code(404).send({ error: 'Rule not found' });
        const allowed = await getUserMailboxIds(user.sub);
        if (!allowed.includes(Number(rule.mailbox_id)))
            return reply.code(403).send({ error: 'Access denied' });
        await db.execute({ sql: 'DELETE FROM email_rules WHERE id = ?', args: [id] });
        return { ok: true };
    });
}
