import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';

type JWTUser = { sub: number };

export async function draftRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/drafts', async (req) => {
    const user = req.user as JWTUser;
    const sql = getDb();
    return sql`SELECT * FROM drafts WHERE user_id = ${user.sub} ORDER BY updated_at DESC`;
  });

  app.post('/api/drafts', async (req) => {
    const user = req.user as JWTUser;
    const { id, mailbox_id, to_addr, cc, bcc, subject, body, in_reply_to, references_header } = req.body as {
      id?: number; mailbox_id?: number; to_addr?: string; cc?: string; bcc?: string;
      subject?: string; body?: string; in_reply_to?: string; references_header?: string;
    };

    const sql = getDb();

    if (id) {
      await sql`
        UPDATE drafts SET
          mailbox_id        = COALESCE(${mailbox_id ?? null}, mailbox_id),
          to_addr           = ${to_addr ?? null},
          cc                = ${cc ?? null},
          bcc               = ${bcc ?? null},
          subject           = ${subject ?? null},
          body              = ${body ?? null},
          in_reply_to       = ${in_reply_to ?? null},
          references_header = ${references_header ?? null},
          updated_at        = EXTRACT(EPOCH FROM NOW())::INTEGER
        WHERE id = ${id} AND user_id = ${user.sub}
      `;
      return { ok: true, id };
    }

    const [row] = await sql`
      INSERT INTO drafts (user_id, mailbox_id, to_addr, cc, bcc, subject, body, in_reply_to, references_header)
      VALUES (
        ${user.sub}, ${mailbox_id ?? null}, ${to_addr ?? null}, ${cc ?? null}, ${bcc ?? null},
        ${subject ?? null}, ${body ?? null}, ${in_reply_to ?? null}, ${references_header ?? null}
      )
      RETURNING id
    `;
    return { ok: true, id: Number(row.id) };
  });

  app.delete('/api/drafts/:id', async (req, reply) => {
    const user = req.user as JWTUser;
    const { id } = req.params as { id: string };
    const sql = getDb();
    const result = await sql`DELETE FROM drafts WHERE id = ${id} AND user_id = ${user.sub}`;
    if (result.count === 0) return reply.code(404).send({ error: 'Draft not found' });
    return { ok: true };
  });
}
