import nodemailer from 'nodemailer';
import { createClient as createWebDavClient } from 'webdav';
import { getDb } from './db.js';
import { decrypt } from './crypto.js';
import type { Mailbox } from './db.js';

const NEXTCLOUD_THRESHOLD = parseInt(process.env.NEXTCLOUD_THRESHOLD ?? '10485760', 10);

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendMailOptions {
  mailboxId: number;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments: MailAttachment[];
  inReplyTo?: string;
  references?: string[];
}

export async function sendMail(opts: SendMailOptions): Promise<void> {
  const db = getDb();
  const mb = db.prepare('SELECT * FROM mailboxes WHERE id = ?').get(opts.mailboxId) as Mailbox | undefined;
  if (!mb) throw new Error('Mailbox not found');

  const password = decrypt(mb.password_enc);

  const transporter = nodemailer.createTransport({
    host: mb.smtp_host,
    port: mb.smtp_port,
    secure: mb.smtp_secure === 1,
    auth: { user: mb.email, pass: password },
    tls: { rejectUnauthorized: false },
  });

  // Process large attachments — upload to Nextcloud, replace with link
  const regularAttachments: nodemailer.Attachment[] = [];
  let cloudLinksHtml = '';

  for (const att of opts.attachments) {
    if (att.content.length >= NEXTCLOUD_THRESHOLD) {
      const link = await uploadToNextcloud(att.filename, att.content, att.contentType);
      cloudLinksHtml += `<p><strong>Вложение:</strong> <a href="${link}">${att.filename}</a> (${formatSize(att.content.length)}) — файл размещён в облаке</p>`;
    } else {
      regularAttachments.push({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      });
    }
  }

  const htmlBody = (opts.html ?? opts.text?.replace(/\n/g, '<br>') ?? '') + (cloudLinksHtml ? `<hr>${cloudLinksHtml}` : '');

  await transporter.sendMail({
    from: opts.from,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    text: opts.text,
    html: htmlBody,
    attachments: regularAttachments,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  });
}

async function uploadToNextcloud(filename: string, content: Buffer, contentType: string): Promise<string> {
  const ncUrl = process.env.NEXTCLOUD_URL;
  const ncUser = process.env.NEXTCLOUD_USER;
  const ncPass = process.env.NEXTCLOUD_PASSWORD;
  const ncPath = process.env.NEXTCLOUD_UPLOAD_PATH ?? '/AlfaMail-Attachments';

  if (!ncUrl || !ncUser || !ncPass) {
    throw new Error('Nextcloud not configured. Set NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_PASSWORD in .env');
  }

  const client = createWebDavClient(`${ncUrl}/remote.php/dav/files/${ncUser}`, {
    username: ncUser,
    password: ncPass,
  });

  // Ensure upload directory exists
  try {
    await client.createDirectory(ncPath);
  } catch {
    // Directory may already exist
  }

  const uniqueName = `${Date.now()}-${filename}`;
  const remotePath = `${ncPath}/${uniqueName}`;
  await client.putFileContents(remotePath, content, { contentLength: content.length });

  // Create public share link
  const shareLink = await createNextcloudShare(`${ncUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares`, ncUser, ncPass, `/files/${ncUser}${remotePath}`);
  return shareLink;
}

async function createNextcloudShare(apiUrl: string, user: string, pass: string, filePath: string): Promise<string> {
  const body = new URLSearchParams({
    path: filePath,
    shareType: '3', // public link
    permissions: '1', // read only
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'OCS-APIRequest': 'true',
    },
    body: body.toString(),
  });

  if (!response.ok) throw new Error(`Nextcloud share failed: ${response.statusText}`);

  const text = await response.text();
  const match = text.match(/<url>(.*?)<\/url>/);
  if (!match) throw new Error('Could not parse Nextcloud share URL');
  return match[1];
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
