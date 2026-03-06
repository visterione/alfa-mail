import 'dotenv/config';
import Fastify from 'fastify';
import { initDb } from './db.js';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { mailRoutes } from './routes/mail.js';

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

// JWT
await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
});

// Multipart (for file uploads)
await app.register(multipart, {
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max upload
});

// Auth decorator
app.decorate('authenticate', async (req: Parameters<typeof app.authenticate>[0], reply: Parameters<typeof app.authenticate>[1]) => {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorized' });
  }
});

// Init DB
await initDb();

// Routes
await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(mailRoutes);

// Health
app.get('/api/health', async () => ({ ok: true }));

const PORT = parseInt(process.env.PORT ?? '3001', 10);
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`AlfaMail server running on port ${PORT}`);
