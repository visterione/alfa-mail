import 'dotenv/config';
import Fastify from 'fastify';
import { initDb } from './db.js';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { mailRoutes } from './routes/mail.js';
import { draftRoutes } from './routes/drafts.js';
import { contactRoutes } from './routes/contacts.js';
import { ruleRoutes } from './routes/rules.js';
const app = Fastify({ logger: true });
// CORS — allow the Vite dev server and production origin
await app.register(cors, {
    origin: [
        'http://localhost:5173',
        'http://localhost:4173',
        process.env.FRONTEND_ORIGIN ?? '',
    ].filter(Boolean),
    credentials: true,
});
// Rate limiting — protect against brute-force and abuse
await app.register(rateLimit, {
    global: true,
    max: 200, // 200 requests per minute per IP
    timeWindow: 60_000,
    // Stricter limit for auth endpoints
    keyGenerator: (req) => req.ip,
});
// JWT
await app.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
});
// Multipart (for file uploads)
await app.register(multipart, {
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max upload
});
// Auth decorator
app.decorate('authenticate', async (req, reply) => {
    try {
        await req.jwtVerify();
    }
    catch {
        reply.code(401).send({ error: 'Unauthorized' });
    }
});
// Init DB
await initDb();
// Routes
await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(mailRoutes);
await app.register(draftRoutes);
await app.register(contactRoutes);
await app.register(ruleRoutes);
// Health
app.get('/api/health', async () => ({ ok: true }));
const PORT = parseInt(process.env.PORT ?? '3001', 10);
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`AlfaMail server running on port ${PORT}`);
