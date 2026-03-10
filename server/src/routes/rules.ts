import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';

type JWTUser = { sub: number };

async function getUserMailboxIds(userId: number): Promise<number[]> {
  const sql = getDb();
  const rows = await sql`SELECT mailbox_id FROM user_mailboxes WHERE user_id = ${userId}`;
  return rows.map((r) => Number(r.mailbox_id));
}

export async function ruleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // GET /api/rules?mailbox_id=1
  app.get('/api/rules', async (req, reply) => {
    const user = req.user as JWTUser;
    const { mailbox_id } = req.query as { mailbox_id?: string };
    if (!mailbox_id) return reply.code(400).send({ error: 'mailbox_id required' });

    const mbId = parseInt(mailbox_id, 10);
    const allowed = await getUserMailboxIds(user.sub);
    if (!allowed.includes(mbId)) return reply.code(403).send({ error: 'Access denied' });

    const sql = getDb();
    return sql`SELECT * FROM email_rules WHERE mailbox_id = ${mbId} ORDER BY priority, id`;
  });

  // POST /api/rules
  app.post('/api/rules', async (req, reply) => {
    const user = req.user as JWTUser;
    const {
      mailbox_id, name, condition_field, condition_op,
      condition_value, action, action_param, priority,
    } = req.body as {
      mailbox_id?: number;
      name?: string;
      condition_field?: string;
      condition_op?: string;
      condition_value?: string;
      action?: string;
      action_param?: string;
      priority?: number;
    };

    if (!mailbox_id || !name || !condition_field || !condition_op || !condition_value || !action) {
      return reply.code(400).send({ error: 'mailbox_id, name, condition_field, condition_op, condition_value, action required' });
    }

    const validFields = ['from', 'to', 'subject', 'any'];
    const validOps = ['contains', 'equals'];
    const validActions = ['move', 'flag', 'mark_read', 'delete'];

    if (!validFields.includes(condition_field)) return reply.code(400).send({ error: 'Invalid condition_field' });
    if (!validOps.includes(condition_op)) return reply.code(400).send({ error: 'Invalid condition_op' });
    if (!validActions.includes(action)) return reply.code(400).send({ error: 'Invalid action' });
    if (action === 'move' && !action_param) return reply.code(400).send({ error: 'action_param (folder) required for move action' });

    const allowed = await getUserMailboxIds(user.sub);
    if (!allowed.includes(mailbox_id)) return reply.code(403).send({ error: 'Access denied' });

    const sql = getDb();
    const [row] = await sql`
      INSERT INTO email_rules (mailbox_id, name, condition_field, condition_op, condition_value, action, action_param, priority)
      VALUES (${mailbox_id}, ${name}, ${condition_field}, ${condition_op}, ${condition_value}, ${action}, ${action_param ?? null}, ${priority ?? 0})
      RETURNING id
    `;
    return { ok: true, id: Number(row.id) };
  });

  // PATCH /api/rules/:id — toggle active
  app.patch('/api/rules/:id', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const { active } = req.body as { active?: boolean };

    const sql = getDb();
    const [rule] = await sql`SELECT mailbox_id FROM email_rules WHERE id = ${id}`;
    if (!rule) return reply.code(404).send({ error: 'Rule not found' });

    const allowed = await getUserMailboxIds(user.sub);
    if (!allowed.includes(Number(rule.mailbox_id))) return reply.code(403).send({ error: 'Access denied' });

    await sql`UPDATE email_rules SET active = ${active ? 1 : 0} WHERE id = ${id}`;
    return { ok: true };
  });

  // DELETE /api/rules/:id
  app.delete('/api/rules/:id', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };

    const sql = getDb();
    const [rule] = await sql`SELECT mailbox_id FROM email_rules WHERE id = ${id}`;
    if (!rule) return reply.code(404).send({ error: 'Rule not found' });

    const allowed = await getUserMailboxIds(user.sub);
    if (!allowed.includes(Number(rule.mailbox_id))) return reply.code(403).send({ error: 'Access denied' });

    await sql`DELETE FROM email_rules WHERE id = ${id}`;
    return { ok: true };
  });
}
