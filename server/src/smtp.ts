import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { createClient as createWebDavClient } from 'webdav';
import { getDb } from './db.js';
import { decrypt } from './crypto.js';
import type { Mailbox } from './db.js';
import https from 'https';
import { appendToSentFolder } from './imap.js';

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

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
  signatureHtml?: string;
  attachments: MailAttachment[];
  inReplyTo?: string;
  references?: string[];
}

export async function sendMail(opts: SendMailOptions): Promise<void> {
  const sql = getDb();
  const [mb] = await sql<Mailbox[]>`SELECT * FROM mailboxes WHERE id = ${opts.mailboxId}`;
  if (!mb) throw new Error('Mailbox not found');

  const password = decrypt(mb.password_enc);

  const transporter = nodemailer.createTransport({
    host: mb.smtp_host,
    port: mb.smtp_port,
    secure: mb.smtp_secure === 1,
    auth: { user: mb.email, pass: password },
    tls: { rejectUnauthorized: false },
  });

  // Process attachments — large ones go to Nextcloud, small ones are MIME-attached
  const regularAttachments: { filename: string; content: Buffer; contentType: string; cid?: string }[] = [];
  // All attachment cards for the email body (cloud = link, regular = visual only)
  const attachCards: string[] = [];
  const cloudWarnings: string[] = [];

  for (const att of opts.attachments) {
    if (att.content.length >= NEXTCLOUD_THRESHOLD) {
      try {
        const link = await uploadToNextcloud(att.filename, att.content, att.contentType);
        attachCards.push(buildAttachCard(att.filename, att.content.length, link));
      } catch (err) {
        console.error('[smtp] Nextcloud upload failed, falling back to regular attachment:', err);
        cloudWarnings.push(att.filename);
        regularAttachments.push({ filename: att.filename, content: att.content, contentType: att.contentType });
        attachCards.push(buildAttachCard(att.filename, att.content.length, null));
      }
    } else {
      regularAttachments.push({ filename: att.filename, content: att.content, contentType: att.contentType });
      attachCards.push(buildAttachCard(att.filename, att.content.length, null));
    }
  }

  let warningHtml = '';
  if (cloudWarnings.length > 0) {
    warningHtml = `<p style="margin:0 0 12px 0;color:#b25000;font-size:12px;"><strong>Внимание:</strong> Файлы (${cloudWarnings.join(', ')}) не удалось загрузить в Nextcloud, они прикреплены напрямую.</p>`;
  }

  const mainContent = opts.html ?? opts.text?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g, '<br>') ?? '';

  // Extract base64 logo from signatureHtml and convert to CID attachment (works in Gmail, Outlook, etc.)
  let processedSignatureHtml = opts.signatureHtml;
  const cidAttachments: { filename: string; content: Buffer; contentType: string; cid: string }[] = [];
  if (processedSignatureHtml) {
    const dataUriMatch = processedSignatureHtml.match(/src="(data:(image\/[^;]+);base64,([^"]{1,500000}))"/);
    if (dataUriMatch) {
      const mimeType = dataUriMatch[2];
      const base64Data = dataUriMatch[3];
      const cid = 'signature-logo@alfamail';
      processedSignatureHtml = processedSignatureHtml.replace(dataUriMatch[1], `cid:${cid}`);
      cidAttachments.push({
        filename: 'logo',
        content: Buffer.from(base64Data, 'base64'),
        contentType: mimeType,
        cid,
      });
    }
  }

  const htmlBody = wrapEmailHtml(mainContent, processedSignatureHtml, attachCards, warningHtml);

  const mailOptions = {
    from: opts.from,
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    text: opts.text,
    html: htmlBody,
    attachments: [...regularAttachments, ...cidAttachments],
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  };

  await transporter.sendMail(mailOptions);

  // Save to Sent folder via IMAP append
  try {
    const rawMessage = await new Promise<Buffer>((resolve, reject) => {
      new MailComposer(mailOptions).compile().build((err: Error | null, msg: Buffer) => {
        if (err) reject(err); else resolve(msg);
      });
    });
    await appendToSentFolder(opts.mailboxId, rawMessage);
  } catch (err) {
    console.error('[smtp] Failed to append to Sent folder:', err);
  }
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
    httpsAgent: insecureAgent,
  });

  // Ensure upload directory exists
  try {
    await client.createDirectory(ncPath);
  } catch {
    // Directory may already exist
  }

  // Resolve filename conflict like Windows Explorer: file.ext → file(1).ext → file(2).ext
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext  = dot > 0 ? filename.slice(dot) : '';
  let candidateName = filename;
  let counter = 1;
  while (await client.exists(`${ncPath}/${candidateName}`)) {
    candidateName = `${base}(${counter})${ext}`;
    counter++;
  }
  const remotePath = `${ncPath}/${candidateName}`;
  await client.putFileContents(remotePath, content, { contentLength: content.length });

  // Create public share link
  const shareLink = await createNextcloudShare(`${ncUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares`, ncUser, ncPass, remotePath);
  return shareLink;
}

async function createNextcloudShare(apiUrl: string, user: string, pass: string, filePath: string): Promise<string> {
  const body = new URLSearchParams({
    path: filePath,
    shareType: '3', // public link
    permissions: '1', // read only
  }).toString();

  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'OCS-APIRequest': 'true',
        'Content-Length': Buffer.byteLength(body),
      },
      agent: insecureAgent,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          return reject(new Error(`Nextcloud share failed: ${res.statusCode}`));
        }
        const match = data.match(/<url>(.*?)<\/url>/);
        if (!match) return reject(new Error('Could not parse Nextcloud share URL'));
        resolve(match[1]);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// url=null means regular MIME attachment (no clickable link), url=string means cloud link
function buildAttachCard(filename: string, size: number, url: string | null): string {
  const ext = (filename.split('.').pop() ?? 'FILE').toUpperCase().slice(0, 4);
  const extColors: Record<string, string> = {
    PDF: '#e84d3d', DOC: '#2b5dde', DOCX: '#2b5dde', XLS: '#1e7e43', XLSX: '#1e7e43',
    PPT: '#d14524', PPTX: '#d14524', ZIP: '#8547c6', RAR: '#8547c6', '7Z': '#8547c6',
    PNG: '#0a84ff', JPG: '#0a84ff', JPEG: '#0a84ff', GIF: '#0a84ff', WEBP: '#0a84ff',
    MP4: '#ff9f0a', MOV: '#ff9f0a', MP3: '#ff9f0a', WAV: '#ff9f0a',
  };
  const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
  const color = extColors[ext] ?? '#636366';
  const safeName = filename.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const label = url ? 'Загружен в облако' : 'Прикреплён к письму';
  const badge = `<table cellpadding="0" cellspacing="0" border="0" style="display:inline-table;"><tr><td style="width:40px;height:40px;border-radius:8px;background:${color};text-align:center;vertical-align:middle;font-size:9px;font-weight:700;color:#ffffff;letter-spacing:0.2px;font-family:monospace;">${ext}</td></tr></table>`;
  const inner = `<table cellpadding="0" cellspacing="0" border="0" width="360" style="border:1px solid #e5e5ea;border-radius:12px;background:#f9f9fb;"><tr><td style="padding:12px 16px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td style="vertical-align:middle;padding-right:12px;">${badge}</td><td style="vertical-align:middle;"><div style="font-family:${FONT};font-size:13px;font-weight:500;color:#1d1d1f;max-width:250px;overflow:hidden;white-space:nowrap;">${safeName}</div><div style="font-family:${FONT};font-size:11px;color:#8e8e93;margin-top:3px;">${formatSize(size)}&nbsp;&bull;&nbsp;${label}</div></td></tr></table></td></tr></table>`;
  if (url) {
    return `<a href="${url}" target="_blank" style="display:block;text-decoration:none;margin:4px 0;">${inner}</a>`;
  }
  return `<div style="display:inline-block;margin:4px 0;">${inner}</div>`;
}

function wrapEmailHtml(bodyHtml: string, signatureHtml: string | undefined, attachCards: string[], warningHtml: string): string {
  // Inter loads in Apple Mail, Yahoo, Thunderbird via <link>; Gmail ignores <head> but gets system font fallback (not Times New Roman)
  // All <td> get explicit font-family to prevent any client from falling back to browser default serif
  const FONT = `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

  const sigSection = signatureHtml
    ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;"><tr><td style="border-top:1px solid #e5e5ea;padding-top:16px;font-family:${FONT};font-size:13px;color:#3c3c43;line-height:1.6;">${signatureHtml}</td></tr></table>`
    : '';

  const attachSection = attachCards.length > 0
    ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;border-top:1px solid #e5e5ea;padding-top:16px;"><tr><td style="font-family:${FONT};">
        ${warningHtml}
        <div style="font-family:${FONT};font-size:11px;font-weight:600;color:#8e8e93;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:8px;">Вложения</div>
        ${attachCards.join('\n')}
      </td></tr></table>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>body,td,div,p,a{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${FONT};">
<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="padding:24px 16px;font-family:${FONT};">
<table cellpadding="0" cellspacing="0" border="0" width="680" style="max-width:680px;">
<tr><td style="font-family:${FONT};font-size:14px;color:#1d1d1f;line-height:1.6;">${bodyHtml}</td></tr>
${sigSection ? `<tr><td>${sigSection}</td></tr>` : ''}
${attachSection ? `<tr><td>${attachSection}</td></tr>` : ''}
</table>
</td></tr></table>
</body>
</html>`;
}
