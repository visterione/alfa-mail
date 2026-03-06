import { createClient, type Client } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');

let _db: Client | null = null;

export function getDb(): Client {
  if (!_db) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    _db = createClient({ url: `file:${path.join(DATA_DIR, 'alfa-mail.db')}` });
  }
  return _db;
}

export async function initDb(): Promise<void> {
  const db = getDb();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS mailboxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL DEFAULT 993,
      imap_secure INTEGER NOT NULL DEFAULT 1,
      smtp_host TEXT NOT NULL,
      smtp_port INTEGER NOT NULL DEFAULT 587,
      smtp_secure INTEGER NOT NULL DEFAULT 0,
      password_enc TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_mailboxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      UNIQUE(user_id, mailbox_id)
    );

    CREATE TABLE IF NOT EXISTS message_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      folder TEXT NOT NULL,
      uid INTEGER NOT NULL,
      seq INTEGER,
      message_id TEXT,
      from_addr TEXT,
      from_name TEXT,
      to_addrs TEXT,
      subject TEXT,
      date INTEGER,
      snippet TEXT,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      seen INTEGER NOT NULL DEFAULT 0,
      flagged INTEGER NOT NULL DEFAULT 0,
      size INTEGER,
      UNIQUE(mailbox_id, folder, uid)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
      subject,
      from_addr,
      from_name,
      snippet,
      content='message_cache',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS mc_ai AFTER INSERT ON message_cache BEGIN
      INSERT INTO message_fts(rowid, subject, from_addr, from_name, snippet)
      VALUES (new.id, new.subject, new.from_addr, new.from_name, new.snippet);
    END;

    CREATE TRIGGER IF NOT EXISTS mc_ad AFTER DELETE ON message_cache BEGIN
      INSERT INTO message_fts(message_fts, rowid, subject, from_addr, from_name, snippet)
      VALUES ('delete', old.id, old.subject, old.from_addr, old.from_name, old.snippet);
    END;

    CREATE TRIGGER IF NOT EXISTS mc_au AFTER UPDATE ON message_cache BEGIN
      INSERT INTO message_fts(message_fts, rowid, subject, from_addr, from_name, snippet)
      VALUES ('delete', old.id, old.subject, old.from_addr, old.from_name, old.snippet);
      INSERT INTO message_fts(rowid, subject, from_addr, from_name, snippet)
      VALUES (new.id, new.subject, new.from_addr, new.from_name, new.snippet);
    END;

    CREATE INDEX IF NOT EXISTS idx_mc_mailbox_folder ON message_cache(mailbox_id, folder, date DESC);
    CREATE INDEX IF NOT EXISTS idx_mc_seen ON message_cache(mailbox_id, folder, seen);
    CREATE INDEX IF NOT EXISTS idx_um_user ON user_mailboxes(user_id);

    CREATE TABLE IF NOT EXISTS sync_state (
      mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      folder TEXT NOT NULL,
      last_uid INTEGER NOT NULL DEFAULT 0,
      last_synced INTEGER,
      PRIMARY KEY (mailbox_id, folder)
    );
  `);
}

export type User = {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  is_admin: number;
};

export type Mailbox = {
  id: number;
  email: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  imap_secure: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  password_enc: string;
};

export type MessageCache = {
  id: number;
  mailbox_id: number;
  folder: string;
  uid: number;
  seq: number | null;
  message_id: string | null;
  from_addr: string | null;
  from_name: string | null;
  to_addrs: string | null;
  subject: string | null;
  date: number | null;
  snippet: string | null;
  has_attachments: number;
  seen: number;
  flagged: number;
  size: number | null;
};

// Helper: convert libsql ResultSet row to typed object
export function rowToObj<T>(row: Record<string, unknown>): T {
  return row as unknown as T;
}
