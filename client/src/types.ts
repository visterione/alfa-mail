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
}

export interface MessageSummary {
  id: number;
  mailbox_id: number;
  folder: string;
  uid: number;
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
