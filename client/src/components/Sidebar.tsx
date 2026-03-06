import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Inbox, Send, Trash2, AlertOctagon, Folder as FolderIcon,
  ChevronDown, PenSquare, Search, Settings, LogOut,
  type LucideProps,
} from 'lucide-react';
import { type ForwardRefExoticComponent, type RefAttributes } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { MailboxInfo, Folder } from '../types';

type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

const FOLDER_ICONS: Record<string, LucideIcon> = {
  '\\Inbox': Inbox,
  '\\Sent': Send,
  '\\Trash': Trash2,
  '\\Junk': AlertOctagon,
};

const FOLDER_LABELS: Record<string, string> = {
  INBOX: 'Входящие',
  Sent: 'Отправленные',
  'Sent Messages': 'Отправленные',
  Trash: 'Корзина',
  Junk: 'Спам',
  Spam: 'Спам',
  Drafts: 'Черновики',
  Archive: 'Архив',
};

function getFolderLabel(folder: Folder): string {
  return FOLDER_LABELS[folder.path] ?? FOLDER_LABELS[folder.name] ?? folder.name;
}

function getFolderIcon(folder: Folder) {
  if (folder.specialUse && FOLDER_ICONS[folder.specialUse]) {
    const Icon = FOLDER_ICONS[folder.specialUse];
    return <Icon size={15} />;
  }
  if (folder.path === 'INBOX' || folder.name === 'INBOX') return <Inbox size={15} />;
  if (/sent/i.test(folder.name)) return <Send size={15} />;
  if (/trash/i.test(folder.name)) return <Trash2 size={15} />;
  if (/junk|spam/i.test(folder.name)) return <AlertOctagon size={15} />;
  return <FolderIcon size={15} />;
}

interface Props {
  mailboxes: MailboxInfo[];
}

export default function Sidebar({ mailboxes, onOpenAdmin }: Props & { onOpenAdmin: () => void }) {
  const { activeMailbox, setActiveMailbox, activeFolder, setActiveFolder, openCompose, setSearchQuery, setIsSearching, user, setUser } = useStore();
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const { data: folders } = useQuery({
    queryKey: ['folders', activeMailbox?.id],
    queryFn: () => api.getFolders(activeMailbox!.id),
    enabled: !!activeMailbox,
  });

  function handleLogout() {
    localStorage.removeItem('token');
    setUser(null);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchInput.trim();
    if (q.length < 2) return;
    setSearchQuery(q);
    setIsSearching(true);
  }

  function clearSearch() {
    setSearchInput('');
    setSearchQuery('');
    setIsSearching(false);
  }

  return (
    <aside className="w-60 flex-shrink-0 h-full flex flex-col py-3 pl-3 pr-0">
      <div className="flex-1 bg-white rounded-2xl shadow-card flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-5 pb-3">
          <div className="flex items-center justify-between mb-4">
            <span className="font-semibold text-sm text-[#1d1d1f]">AlfaMail</span>
            <button
              onClick={() => openCompose()}
              className="flex items-center gap-1 bg-accent text-white text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
            >
              <PenSquare size={13} />
              Написать
            </button>
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#aeaeb2]" />
            <input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                if (!e.target.value) clearSearch();
              }}
              placeholder="Поиск..."
              className="w-full bg-[#f5f5f7] rounded-lg pl-7 pr-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent/20 transition-shadow"
            />
          </form>
        </div>

        {/* Mailbox switcher */}
        <div className="px-3 mb-1">
          <button
            onClick={() => setMailboxOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-xl hover:bg-[#f5f5f7] transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
              {activeMailbox?.email.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#1d1d1f] truncate">
                {activeMailbox?.display_name ?? activeMailbox?.email}
              </p>
              <p className="text-[10px] text-muted truncate">{activeMailbox?.email}</p>
            </div>
            <ChevronDown size={13} className={`text-muted transition-transform ${mailboxOpen ? 'rotate-180' : ''}`} />
          </button>

          {mailboxOpen && mailboxes.length > 1 && (
            <div className="mt-1 ml-9 space-y-0.5">
              {mailboxes.map((mb) => (
                <button
                  key={mb.id}
                  onClick={() => { setActiveMailbox(mb); setMailboxOpen(false); }}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded-lg transition-colors truncate ${
                    activeMailbox?.id === mb.id
                      ? 'text-accent font-medium'
                      : 'text-[#1d1d1f] hover:bg-[#f5f5f7]'
                  }`}
                >
                  {mb.display_name ?? mb.email}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mx-3 h-px bg-[#f5f5f7] mb-1" />

        {/* Folders */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {folders?.map((folder) => (
            <FolderItem
              key={folder.path}
              folder={folder}
              active={activeFolder === folder.path}
              onClick={() => { setActiveFolder(folder.path); clearSearch(); }}
            />
          ))}
        </nav>

        {/* Footer */}
        <div className="mx-3 h-px bg-[#f5f5f7]" />
        <div className="p-3 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-[#1d1d1f] truncate">{user?.display_name}</p>
            <p className="text-[10px] text-muted truncate">{user?.username}</p>
          </div>
          {user?.is_admin ? (
            <button onClick={onOpenAdmin} className="p-1.5 rounded-lg hover:bg-[#f5f5f7] transition-colors text-muted" title="Настройки">
              <Settings size={14} />
            </button>
          ) : null}
          <button onClick={handleLogout} className="p-1.5 rounded-lg hover:bg-[#f5f5f7] transition-colors text-muted">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function FolderItem({ folder, active, onClick }: { folder: Folder; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left transition-colors ${
        active
          ? 'bg-accent/10 text-accent'
          : 'text-[#1d1d1f] hover:bg-[#f5f5f7]'
      }`}
    >
      <span className={active ? 'text-accent' : 'text-[#6e6e73]'}>
        {getFolderIcon(folder)}
      </span>
      <span className="text-xs font-medium truncate flex-1">{getFolderLabel(folder)}</span>
    </button>
  );
}
