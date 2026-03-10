import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Inbox, Send, Trash2, AlertOctagon, Folder as FolderIcon,
  ChevronDown, Plus,
  type LucideProps,
} from 'lucide-react';
import { type ForwardRefExoticComponent, type RefAttributes } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { getFolderLabel, isSystemFolder, isMainFolder } from '../folderUtils';
import type { MailboxInfo, Folder } from '../types';

type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

const FOLDER_ICONS: Record<string, LucideIcon> = {
  '\\Inbox': Inbox,
  '\\Sent': Send,
  '\\Trash': Trash2,
  '\\Junk': AlertOctagon,
};

function getFolderIcon(folder: Folder) {
  if (folder.specialUse && FOLDER_ICONS[folder.specialUse]) {
    const Icon = FOLDER_ICONS[folder.specialUse];
    return <Icon size={17} />;
  }
  if (folder.path === 'INBOX' || folder.name === 'INBOX') return <Inbox size={17} />;
  if (/sent/i.test(folder.name)) return <Send size={17} />;
  if (/trash/i.test(folder.name)) return <Trash2 size={17} />;
  if (/junk|spam/i.test(folder.name)) return <AlertOctagon size={17} />;
  return <FolderIcon size={17} />;
}

interface Props {
  mailboxes: MailboxInfo[];
}

interface ContextMenuState {
  folder: Folder;
  x: number;
  y: number;
}

export default function Sidebar({ mailboxes }: Props) {
  const { activeMailbox, setActiveMailbox, activeFolder, setActiveFolder, setSearchQuery, setIsSearching } = useStore();
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renaming, setRenaming] = useState<{ folder: Folder; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: folders } = useQuery({
    queryKey: ['folders', activeMailbox?.id],
    queryFn: () => api.getFolders(activeMailbox!.id),
    enabled: !!activeMailbox,
  });

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  useEffect(() => {
    if (creating) setTimeout(() => createInputRef.current?.focus(), 30);
  }, [creating]);

  useEffect(() => {
    if (renaming) setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 30);
  }, [renaming]);

  function clearSearch() {
    setSearchQuery('');
    setIsSearching(false);
  }

  async function handleCreate() {
    if (!activeMailbox || !newFolderName.trim() || busy) return;
    setBusy(true);
    try {
      await api.createFolder(activeMailbox.id, newFolderName.trim());
      setCreating(false);
      setNewFolderName('');
      qc.invalidateQueries({ queryKey: ['folders', activeMailbox.id] });
    } finally {
      setBusy(false);
    }
  }

  async function handleRename() {
    if (!activeMailbox || !renaming?.name.trim() || busy) return;
    const { folder, name } = renaming;
    setBusy(true);
    try {
      let newPath = name.trim();
      if (folder.delimiter) {
        const parts = folder.path.split(folder.delimiter);
        parts[parts.length - 1] = name.trim();
        newPath = parts.join(folder.delimiter);
      }
      await api.renameFolder(activeMailbox.id, folder.path, newPath);
      if (activeFolder === folder.path) setActiveFolder(newPath);
      setRenaming(null);
      qc.invalidateQueries({ queryKey: ['folders', activeMailbox.id] });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(folder: Folder) {
    if (!activeMailbox || busy) return;
    setBusy(true);
    try {
      await api.deleteFolder(activeMailbox.id, folder.path);
      if (activeFolder === folder.path) setActiveFolder('INBOX');
      qc.invalidateQueries({ queryKey: ['folders', activeMailbox.id] });
    } finally {
      setBusy(false);
    }
  }

  async function handleEmpty(folder: Folder) {
    if (!activeMailbox || busy) return;
    setBusy(true);
    try {
      await api.emptyFolder(activeMailbox.id, folder.path);
      qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, folder.path] });
      qc.invalidateQueries({ queryKey: ['folders', activeMailbox.id] });
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkAllRead(folder: Folder) {
    if (!activeMailbox || busy) return;
    setBusy(true);
    try {
      await api.markAllRead(activeMailbox.id, folder.path);
      qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, folder.path] });
      qc.invalidateQueries({ queryKey: ['folders', activeMailbox.id] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-shrink-0">
      {/* Mailbox switcher */}
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={() => setMailboxOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-2 py-2.5 rounded-xl hover:bg-[#f5f5f7] transition-colors text-left"
        >
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
            {(activeMailbox?.email ?? '').charAt(0).toUpperCase() || (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/>
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#1d1d1f] truncate">
              {activeMailbox?.display_name ?? activeMailbox?.email}
            </p>
            <p className="text-xs text-muted truncate">{activeMailbox?.email}</p>
          </div>
          <ChevronDown size={15} className={`text-muted transition-transform flex-shrink-0 ${mailboxOpen ? 'rotate-180' : ''}`} />
        </button>

        {mailboxOpen && mailboxes.length > 1 && (
          <div className="animate-dropdown mt-1 ml-10 space-y-0.5">
            {mailboxes.map((mb) => (
              <button
                key={mb.id}
                onClick={() => { setActiveMailbox(mb); setMailboxOpen(false); }}
                className={`w-full text-left text-sm px-2 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  activeMailbox?.id === mb.id
                    ? 'text-accent font-medium'
                    : 'text-[#1d1d1f] hover:bg-[#f5f5f7]'
                }`}
              >
                <span className="truncate flex-1">{mb.display_name ?? mb.email}</span>
                <MailboxUnreadBadge mailboxId={mb.id} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-3 h-px bg-[#f5f5f7]" />

      {/* Folders */}
      <nav className="px-3 py-2">
        {/* Header */}
        <div className="flex items-center justify-between px-1 mb-1.5">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">Папки</span>
          <button
            onClick={() => { setCreating(true); setNewFolderName(''); setRenaming(null); }}
            className="p-0.5 rounded-md hover:bg-[#f5f5f7] text-muted hover:text-[#1d1d1f] transition-colors"
            title="Создать папку"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Grid */}
        {(() => {
          const mainFolders = folders?.filter(isMainFolder) ?? [];
          const customFolders = folders?.filter((f) => !isMainFolder(f)) ?? [];
          const renderItem = (folder: Folder) => (
            <FolderItem
              key={folder.path}
              folder={folder}
              active={activeFolder === folder.path}
              onClick={() => { setActiveFolder(folder.path); clearSearch(); }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ folder, x: e.clientX, y: e.clientY });
              }}
            />
          );
          return (
            <>
              <div className="grid grid-cols-5 gap-1">
                {mainFolders.map(renderItem)}
              </div>
              {customFolders.length > 0 && (
                <div className="grid grid-cols-5 gap-1 mt-1">
                  {customFolders.map(renderItem)}
                </div>
              )}
            </>
          );
        })()}

        {/* Create folder input */}
        {creating && (
          <div className="mt-2 space-y-1">
            <input
              ref={createInputRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') { setCreating(false); setNewFolderName(''); }
              }}
              placeholder="Имя новой папки"
              className="w-full text-xs px-2 py-1.5 rounded-lg border border-[#d1d1d6] focus:outline-none focus:ring-1 focus:ring-accent bg-white"
              disabled={busy}
            />
            <div className="flex gap-1">
              <button
                onClick={handleCreate}
                disabled={busy || !newFolderName.trim()}
                className="flex-1 py-1 text-xs rounded-lg bg-accent text-white disabled:opacity-40"
              >
                Создать
              </button>
              <button
                onClick={() => { setCreating(false); setNewFolderName(''); }}
                className="flex-1 py-1 text-xs rounded-lg hover:bg-[#f5f5f7] text-muted border border-[#e5e5ea]"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {/* Rename input */}
        {renaming && (
          <div className="mt-2 space-y-1">
            <p className="text-[11px] text-muted px-0.5">Переименовать «{getFolderLabel(renaming.folder)}»:</p>
            <input
              ref={renameInputRef}
              value={renaming.name}
              onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="w-full text-xs px-2 py-1.5 rounded-lg border border-[#d1d1d6] focus:outline-none focus:ring-1 focus:ring-accent bg-white"
              disabled={busy}
            />
            <div className="flex gap-1">
              <button
                onClick={handleRename}
                disabled={busy || !renaming.name.trim()}
                className="flex-1 py-1 text-xs rounded-lg bg-accent text-white disabled:opacity-40"
              >
                Сохранить
              </button>
              <button
                onClick={() => setRenaming(null)}
                className="flex-1 py-1 text-xs rounded-lg hover:bg-[#f5f5f7] text-muted border border-[#e5e5ea]"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </nav>

      <div className="mx-3 h-px bg-[#f5f5f7]" />

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
          className="animate-dropdown bg-white rounded-xl shadow-lg border border-[#e5e5ea] py-1 min-w-[190px]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {contextMenu.folder.unread > 0 && (
            <CtxItem onClick={() => { handleMarkAllRead(contextMenu.folder); setContextMenu(null); }}>
              Прочитать все
            </CtxItem>
          )}
          <CtxItem onClick={() => {
            if (confirm(`Удалить все письма в папке «${getFolderLabel(contextMenu.folder)}»?\nЭто действие необратимо.`)) {
              handleEmpty(contextMenu.folder);
            }
            setContextMenu(null);
          }}>
            Очистить папку
          </CtxItem>
          {!isSystemFolder(contextMenu.folder) && (
            <>
              <div className="mx-2 my-1 h-px bg-[#f5f5f7]" />
              <CtxItem onClick={() => {
                const parts = contextMenu.folder.path.split(contextMenu.folder.delimiter ?? '/');
                setRenaming({ folder: contextMenu.folder, name: parts[parts.length - 1] });
                setContextMenu(null);
              }}>
                Переименовать
              </CtxItem>
              <CtxItem danger onClick={() => {
                if (confirm(`Удалить папку «${getFolderLabel(contextMenu.folder)}» со всеми письмами?\nЭто действие необратимо.`)) {
                  handleDelete(contextMenu.folder);
                }
                setContextMenu(null);
              }}>
                Удалить папку
              </CtxItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MailboxUnreadBadge({ mailboxId }: { mailboxId: number }) {
  const { data } = useQuery({
    queryKey: ['folders', mailboxId],
    queryFn: () => api.getFolders(mailboxId),
    staleTime: 60_000,
  });
  const total = data?.reduce((s, f) => s + (f.unread ?? 0), 0) ?? 0;
  if (!total) return null;
  return (
    <span className="flex-shrink-0 text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">
      {total > 99 ? '99+' : total}
    </span>
  );
}

const FOLDER_COLORS: Record<string, {
  icon: string; active: string; hover: string; badge: string;
}> = {
  inbox:  { icon: 'text-blue-500',   active: 'bg-blue-500/10 text-blue-500',   hover: 'hover:bg-blue-50',   badge: 'bg-blue-500'   },
  sent:   { icon: 'text-green-500',  active: 'bg-green-500/10 text-green-500', hover: 'hover:bg-green-50',  badge: 'bg-green-500'  },
  drafts: { icon: 'text-slate-400',  active: 'bg-slate-400/10 text-slate-500', hover: 'hover:bg-slate-100', badge: 'bg-slate-400'  },
  junk:   { icon: 'text-amber-500',  active: 'bg-amber-500/10 text-amber-500', hover: 'hover:bg-amber-50',  badge: 'bg-amber-500'  },
  trash:  { icon: 'text-red-500',    active: 'bg-red-500/10 text-red-500',     hover: 'hover:bg-red-50',    badge: 'bg-red-500'    },
  custom: { icon: 'text-purple-500', active: 'bg-purple-500/10 text-purple-500', hover: 'hover:bg-purple-50', badge: 'bg-purple-500' },
};

function getFolderColorKey(folder: Folder): string {
  const su = folder.specialUse;
  if (folder.path === 'INBOX' || su === '\\Inbox') return 'inbox';
  if (su === '\\Sent' || /sent/i.test(folder.name)) return 'sent';
  if (su === '\\Drafts' || /draft/i.test(folder.name)) return 'drafts';
  if (su === '\\Junk' || /junk|spam/i.test(folder.name)) return 'junk';
  if (su === '\\Trash' || /trash/i.test(folder.name)) return 'trash';
  return 'custom';
}

function FolderItem({ folder, active, onClick, onContextMenu }: {
  folder: Folder;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const c = FOLDER_COLORS[getFolderColorKey(folder)];
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`relative flex flex-col items-center justify-center gap-1 py-2.5 px-1 rounded-xl transition-all active:scale-90 ${
        active ? c.active : `text-[#1d1d1f] ${c.hover}`
      }`}
    >
      {folder.unread > 0 && (
        <span className={`absolute top-1 right-1.5 text-[10px] font-bold leading-none px-1 py-0.5 rounded-full text-white ${c.badge}`}>
          {folder.unread > 99 ? '99+' : folder.unread}
        </span>
      )}
      <span className={active ? '' : c.icon}>
        {getFolderIcon(folder)}
      </span>
      <span className="text-[11px] font-medium leading-tight text-center w-full truncate px-0.5">
        {getFolderLabel(folder)}
      </span>
    </button>
  );
}

function CtxItem({ children, onClick, danger }: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left text-sm px-3 py-1.5 hover:bg-[#f5f5f7] transition-colors ${
        danger ? 'text-red-500' : 'text-[#1d1d1f]'
      }`}
    >
      {children}
    </button>
  );
}
