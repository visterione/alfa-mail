import type { FastifyInstance } from 'fastify';
import { getDb } from '../db.js';

type JWTUser = { sub: number };

export async function contactRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // GET /api/contacts?q=ivan — autocomplete search
  app.get('/api/contacts', async (req) => {
    const user = req.user as JWTUser;
    const { q } = req.query as { q?: string };
    const sql = getDb();

    if (!q || q.trim().length === 0) {
      return sql`
        SELECT id, email, name, use_count FROM contacts
        WHERE user_id = ${user.sub}
        ORDER BY use_count DESC, last_used DESC
        LIMIT 20
      `;
    }

    const term = `%${q.trim().toLowerCase()}%`;
    return sql`
      SELECT id, email, name, use_count FROM contacts
      WHERE user_id = ${user.sub}
        AND (LOWER(email) LIKE ${term} OR LOWER(name) LIKE ${term})
      ORDER BY use_count DESC, last_used DESC
      LIMIT 10
    `;
  });
}

// Helper called after sending a message to record contacts
export async function upsertContacts(userId: number, addresses: { email: string; name?: string }[]) {
  const sql = getDb();
  for (const addr of addresses) {
    if (!addr.email || !addr.email.includes('@')) continue;
    const name = addr.name?.trim() || null;
    const now = Math.floor(Date.now() / 1000);
    await sql`
      INSERT INTO contacts (user_id, email, name, use_count, last_used)
      VALUES (${userId}, ${addr.email.trim()}, ${name}, 1, ${now})
      ON CONFLICT (user_id, email) DO UPDATE SET
        use_count = contacts.use_count + 1,
        last_used  = ${now},
        name       = CASE
                       WHEN EXCLUDED.name IS NOT NULL AND EXCLUDED.name != ''
                       THEN EXCLUDED.name
                       ELSE contacts.name
                     END
    `;
  }
}
