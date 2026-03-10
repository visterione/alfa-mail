import { getDb } from '../db.js';
export async function contactRoutes(app) {
    app.addHook('preHandler', app.authenticate);
    // GET /api/contacts?q=ivan — autocomplete search
    app.get('/api/contacts', async (req) => {
        const user = req.user;
        const { q } = req.query;
        const db = getDb();
        if (!q || q.trim().length === 0) {
            // Return top 20 most-used contacts
            const res = await db.execute({
                sql: 'SELECT id, email, name, use_count FROM contacts WHERE user_id = ? ORDER BY use_count DESC, last_used DESC LIMIT 20',
                args: [user.sub],
            });
            return res.rows;
        }
        const term = q.trim().toLowerCase();
        const res = await db.execute({
            sql: `SELECT id, email, name, use_count FROM contacts
            WHERE user_id = ? AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?)
            ORDER BY use_count DESC, last_used DESC LIMIT 10`,
            args: [user.sub, `%${term}%`, `%${term}%`],
        });
        return res.rows;
    });
}
// Helper called after sending a message to record contacts
export async function upsertContacts(userId, addresses) {
    const db = getDb();
    for (const addr of addresses) {
        if (!addr.email || !addr.email.includes('@'))
            continue;
        await db.execute({
            sql: `INSERT INTO contacts (user_id, email, name, use_count, last_used)
            VALUES (?, ?, ?, 1, unixepoch())
            ON CONFLICT(user_id, email) DO UPDATE SET
              use_count = use_count + 1,
              last_used = unixepoch(),
              name = CASE WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name ELSE name END`,
            args: [userId, addr.email.trim(), addr.name?.trim() || null],
        });
    }
}
