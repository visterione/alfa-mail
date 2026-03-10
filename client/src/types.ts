export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  is_admin: number;
}

export interface MailboxInfo {
  id: number;
  email: string;
  display_name: string | null;
}

export interface Folder {
  name: string;
  path: string;
  delimiter: string | null;
  flags: string[];
  specialUse: string | null;
  subscribed: boolean;
  unread: number;
}

export interface MessageSummary {
  id: number;
  mailbox_id: number;
  folder: string;
  uid: number;
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
}

export interface MessagesPage {
  total: number;
  messages: MessageSummary[];
  syncProgress: { done: number; total: number } | null;
}

export interface MessageFull {
  uid: number;
  envelope: Record<string, unknown>;
  source: string; // base64 encoded raw RFC 2822 message
}

export interface ParsedMessage {
  subject?: string;
  from?: { name?: string; address?: string }[];
  to?: { name?: string; address?: string }[];
  cc?: { name?: string; address?: string }[];
  date?: Date;
  html?: string;
  text?: string;
  attachments?: ParsedAttachment[];
}

export interface ParsedAttachment {
  filename?: string;
  mimeType?: string;
  size?: number;
  content?: Uint8Array;
}

export interface Draft {
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
}

export interface Contact {
  id: number;
  email: string;
  name: string | null;
  use_count: number;
}

export interface EmailRule {
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
}

export interface AuditEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  details: string | null;
  ip: string | null;
  created_at: number;
}

export interface UserSettings {
  signature: string;
  signature_logo: string; // base64 data URL or empty string
}

export interface MailboxSignature {
  signature: string;
  signature_logo: string;
}
