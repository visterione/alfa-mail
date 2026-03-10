import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
let _db = null;
export function getDb() {
    if (!_db) {
        if (!fs.existsSync(DATA_DIR))
            fs.mkdirSync(DATA_DIR, { recursive: true });
        _db = createClient({ url: `file:${path.join(DATA_DIR, 'alfa-mail.db')}` });
    }
    return _db;
}
export async function initDb() {
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
      in_reply_to TEXT,
      thread_id TEXT,
      from_addr TEXT,
      from_name TEXT,
      to_addrs TEXT,
      cc_addrs TEXT,
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
      full_sync_done INTEGER NOT NULL DEFAULT 0,
      last_synced INTEGER,
      PRIMARY KEY (mailbox_id, folder)
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      to_addr TEXT,
      cc TEXT,
      bcc TEXT,
      subject TEXT,
      body TEXT,
      in_reply_to TEXT,
      references_header TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      signature TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      use_count INTEGER NOT NULL DEFAULT 1,
      last_used INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, email)
    );

    CREATE TABLE IF NOT EXISTS email_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      condition_field TEXT NOT NULL,
      condition_op TEXT NOT NULL,
      condition_value TEXT NOT NULL,
      action TEXT NOT NULL,
      action_param TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      action TEXT NOT NULL,
      details TEXT,
      ip TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id, use_count DESC);
    CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rules_mailbox ON email_rules(mailbox_id, priority);
  `);
    // Migrations for existing installs
    const migrations = [
        'ALTER TABLE sync_state ADD COLUMN full_sync_done INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE message_cache ADD COLUMN in_reply_to TEXT',
        'ALTER TABLE message_cache ADD COLUMN thread_id TEXT',
        'ALTER TABLE message_cache ADD COLUMN cc_addrs TEXT',
        'CREATE INDEX IF NOT EXISTS idx_mc_thread ON message_cache(mailbox_id, folder, thread_id)',
    ];
    for (const sql of migrations) {
        try {
            await db.execute(sql);
        }
        catch { /* already exists */ }
    }
}
// Helper: convert libsql ResultSet row to typed object
export function rowToObj(row) {
    return row;
}
// Audit log helper
export async function writeAudit(opts) {
    const db = getDb();
    await db.execute({
        sql: 'INSERT INTO audit_log (user_id, username, action, details, ip) VALUES (?, ?, ?, ?, ?)',
        args: [opts.user_id ?? null, opts.username ?? null, opts.action, opts.details ?? null, opts.ip ?? null],
    });
}
