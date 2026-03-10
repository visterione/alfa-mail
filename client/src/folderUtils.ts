import type { Folder } from './types';

export const FOLDER_LABELS: Record<string, string> = {
  INBOX: 'Входящие',
  Sent: 'Отправленные',
  'Sent Messages': 'Отправленные',
  Trash: 'Корзина',
  Junk: 'Спам',
  Spam: 'Спам',
  Drafts: 'Черновики',
  Archive: 'Архив',
};

const SPECIAL_USE_LABELS: Record<string, string> = {
  '\\Inbox':   'Входящие',
  '\\Sent':    'Отправленные',
  '\\Drafts':  'Черновики',
  '\\Junk':    'Спам',
  '\\Trash':   'Корзина',
  '\\Archive': 'Архив',
};

export function getFolderLabel(folder: Folder): string {
  if (folder.specialUse && SPECIAL_USE_LABELS[folder.specialUse]) {
    return SPECIAL_USE_LABELS[folder.specialUse];
  }
  return FOLDER_LABELS[folder.path] ?? FOLDER_LABELS[folder.name] ?? folder.name;
}

const SYSTEM_SPECIAL_USE = new Set([
  '\\Inbox', '\\Sent', '\\Trash', '\\Junk', '\\Drafts', '\\Archive', '\\Flagged',
]);

export function isSystemFolder(folder: Folder): boolean {
  return folder.path === 'INBOX' ||
    folder.name === 'INBOX' ||
    (folder.specialUse != null && SYSTEM_SPECIAL_USE.has(folder.specialUse));
}

const MAIN_SPECIAL_USE = new Set(['\\Inbox', '\\Sent', '\\Drafts', '\\Junk', '\\Trash']);
const MAIN_NAMES = new Set(['INBOX', 'Sent', 'Sent Messages', 'Drafts', 'Junk', 'Spam', 'Trash']);

export function isMainFolder(folder: Folder): boolean {
  return folder.path === 'INBOX' ||
    (folder.specialUse != null && MAIN_SPECIAL_USE.has(folder.specialUse)) ||
    (!folder.specialUse && MAIN_NAMES.has(folder.name));
}
