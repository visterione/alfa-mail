import postgres from 'postgres';

type DbClient = ReturnType<typeof postgres>;

let _sql: DbClient | null = null;

export function getDb(): DbClient {
  if (!_sql) {
    _sql = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/alfa_mail', {
      max: 20,           // connection pool size
      idle_timeout: 30,  // close idle connections after 30 s
      connect_timeout: 10,
      onnotice: () => {}, // suppress NOTICE messages
    });
  }
  return _sql;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id               SERIAL PRIMARY KEY,
      username         TEXT UNIQUE NOT NULL,
      password_hash    TEXT NOT NULL,
      display_name     TEXT NOT NULL,
      is_admin         SMALLINT NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS mailboxes (
      id               SERIAL PRIMARY KEY,
      email            TEXT UNIQUE NOT NULL,
      display_name     TEXT,
      imap_host        TEXT NOT NULL,
      imap_port        INTEGER NOT NULL DEFAULT 993,
      imap_secure      SMALLINT NOT NULL DEFAULT 1,
      smtp_host        TEXT NOT NULL,
      smtp_port        INTEGER NOT NULL DEFAULT 587,
      smtp_secure      SMALLINT NOT NULL DEFAULT 0,
      password_enc     TEXT NOT NULL,
      signature        TEXT NOT NULL DEFAULT '',
      signature_logo   TEXT NOT NULL DEFAULT '',
      created_at       INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_mailboxes (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mailbox_id   INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      UNIQUE(user_id, mailbox_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS message_cache (
      id               SERIAL PRIMARY KEY,
      mailbox_id       INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      folder           TEXT NOT NULL,
      uid              INTEGER NOT NULL,
      seq              INTEGER,
      message_id       TEXT,
      in_reply_to      TEXT,
      thread_id        TEXT,
      from_addr        TEXT,
      from_name        TEXT,
      to_addrs         TEXT,
      cc_addrs         TEXT,
      subject          TEXT,
      date             INTEGER,
      snippet          TEXT,
      has_attachments  SMALLINT NOT NULL DEFAULT 0,
      seen             SMALLINT NOT NULL DEFAULT 0,
      flagged          SMALLINT NOT NULL DEFAULT 0,
      size             INTEGER,
      search_vector    TSVECTOR,
      UNIQUE(mailbox_id, folder, uid)
    )
  `;

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_mc_mailbox_folder ON message_cache(mailbox_id, folder, date DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_mc_seen          ON message_cache(mailbox_id, folder, seen)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_mc_thread        ON message_cache(mailbox_id, folder, thread_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_mc_search        ON message_cache USING GIN(search_vector)`;

  // FTS trigger: keep search_vector in sync with subject / from / snippet
  await sql`
    CREATE OR REPLACE FUNCTION message_cache_fts_update() RETURNS TRIGGER AS $$
    BEGIN
      NEW.search_vector := to_tsvector('simple',
        COALESCE(NEW.subject,   '') || ' ' ||
        COALESCE(NEW.from_addr, '') || ' ' ||
        COALESCE(NEW.from_name, '') || ' ' ||
        COALESCE(NEW.snippet,   '')
      );
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`DROP TRIGGER IF EXISTS message_cache_fts_trigger ON message_cache`;
  await sql`
    CREATE TRIGGER message_cache_fts_trigger
      BEFORE INSERT OR UPDATE ON message_cache
      FOR EACH ROW EXECUTE FUNCTION message_cache_fts_update()
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS sync_state (
      mailbox_id       INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      folder           TEXT NOT NULL,
      last_uid         INTEGER NOT NULL DEFAULT 0,
      full_sync_done   SMALLINT NOT NULL DEFAULT 0,
      last_synced      INTEGER,
      PRIMARY KEY (mailbox_id, folder)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS drafts (
      id                  SERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mailbox_id          INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      to_addr             TEXT,
      cc                  TEXT,
      bcc                 TEXT,
      subject             TEXT,
      body                TEXT,
      in_reply_to         TEXT,
      references_header   TEXT,
      updated_at          INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      signature      TEXT NOT NULL DEFAULT '',
      signature_logo TEXT NOT NULL DEFAULT '',
      updated_at     INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS contacts (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email      TEXT NOT NULL,
      name       TEXT,
      use_count  INTEGER NOT NULL DEFAULT 1,
      last_used  INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE(user_id, email)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS email_rules (
      id               SERIAL PRIMARY KEY,
      mailbox_id       INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      condition_field  TEXT NOT NULL,
      condition_op     TEXT NOT NULL,
      condition_value  TEXT NOT NULL,
      action           TEXT NOT NULL,
      action_param     TEXT,
      priority         INTEGER NOT NULL DEFAULT 0,
      active           SMALLINT NOT NULL DEFAULT 1,
      created_at       INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username    TEXT,
      action      TEXT NOT NULL,
      details     TEXT,
      ip          TEXT,
      created_at  INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    )
  `;

  // Remaining indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_contacts_user  ON contacts(user_id, use_count DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drafts_user    ON drafts(user_id, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_log(created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rules_mailbox  ON email_rules(mailbox_id, priority)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_um_user        ON user_mailboxes(user_id)`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

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
  signature: string;
  signature_logo: string;
};

export type MessageCache = {
  id: number;
  mailbox_id: number;
  folder: string;
  uid: number;
  seq: number | null;
  message_id: string | null;
  in_reply_to: string | null;
  thread_id: string | null;
  from_addr: string | null;
  from_name: string | null;
  to_addrs: string | null;
  cc_addrs: string | null;
  subject: string | null;
  date: number | null;
  snippet: string | null;
  has_attachments: number;
  seen: number;
  flagged: number;
  size: number | null;
};

export type Draft = {
  id: number;
  user_id: number;
  mailbox_id: number;
  to_addr: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string | null;
  body: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  updated_at: number;
};

export type Contact = {
  id: number;
  user_id: number;
  email: string;
  name: string | null;
  use_count: number;
  last_used: number;
};

export type EmailRule = {
  id: number;
  mailbox_id: number;
  name: string;
  condition_field: string;
  condition_op: string;
  condition_value: string;
  action: string;
  action_param: string | null;
  priority: number;
  active: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function writeAudit(opts: {
  user_id?: number;
  username?: string;
  action: string;
  details?: string;
  ip?: string;
}) {
  const sql = getDb();
  await sql`
    INSERT INTO audit_log (user_id, username, action, details, ip)
    VALUES (${opts.user_id ?? null}, ${opts.username ?? null}, ${opts.action}, ${opts.details ?? null}, ${opts.ip ?? null})
  `;
}
