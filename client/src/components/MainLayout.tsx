import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Settings, LogOut, X, Plus, ChevronDown, User } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import Sidebar from './Sidebar';
import MessageList from './MessageList';
import MessageViewer from './MessageViewer';
import ComposeModal from './ComposeModal';
import SearchResults from './SearchResults';
import AdminPanel from './AdminPanel';
import UserSettingsModal from './UserSettingsModal';

export default function MainLayout() {
  const {
    activeMailbox, setActiveMailbox, composeOpen, isSearching,
    openCompose, setSearchQuery, setIsSearching, user, setUser,
    userSettingsOpen, setUserSettingsOpen,
  } = useStore();
  const [adminOpen, setAdminOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);

  const { data: mailboxes, refetch: refetchMailboxes } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => api.getMailboxes(),
  });

  const { data: folders } = useQuery({
    queryKey: ['folders', activeMailbox?.id],
    queryFn: () => api.getFolders(activeMailbox!.id),
    enabled: !!activeMailbox,
    refetchInterval: 60_000,
  });

  // Restore last selected mailbox from localStorage
  useEffect(() => {
    if (mailboxes && mailboxes.length > 0 && !activeMailbox) {
      const savedId = localStorage.getItem('activeMailboxId');
      const saved = savedId ? mailboxes.find((mb) => mb.id === Number(savedId)) : null;
      setActiveMailbox(saved ?? mailboxes[0]);
    }
  }, [mailboxes, activeMailbox, setActiveMailbox]);

  // Persist selected mailbox
  useEffect(() => {
    if (activeMailbox) {
      localStorage.setItem('activeMailboxId', String(activeMailbox.id));
    }
  }, [activeMailbox]);

  // Update browser tab title with unread count
  useEffect(() => {
    const totalUnread = folders?.reduce((sum, f) => sum + (f.unread || 0), 0) ?? 0;
    document.title = totalUnread > 0 ? `(${totalUnread}) Альфа Почта` : 'Альфа Почта';
  }, [folders]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [userMenuOpen]);

  function handleAdminClose() {
    setAdminOpen(false);
    refetchMailboxes();
  }

  function handleLogout() {
    localStorage.removeItem('token');
    setUser(null);
  }

  // Debounce: fire search automatically 400 ms after the user stops typing
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed.length < 2) {
      if (isSearching) {
        setSearchQuery('');
        setIsSearching(false);
      }
      return;
    }
    const timer = setTimeout(() => {
      setSearchQuery(trimmed);
      setIsSearching(true);
    }, 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchInput.trim();
    if (q.length < 2) return;
    // Instant submit on Enter — bypass the debounce timer
    setSearchQuery(q);
    setIsSearching(true);
  }

  function clearSearch() {
    setSearchInput('');
    setSearchQuery('');
    setIsSearching(false);
  }

  return (
    <div className="h-full flex flex-col bg-[#f5f5f7]">
      {/* Header */}
      <header className="h-16 flex-shrink-0 flex items-center px-4 gap-4 bg-accent">
        <span className="font-semibold text-[17px] text-white w-[30%] flex-shrink-0">
          Альфа Почта
        </span>

        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          <input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              if (!e.target.value) clearSearch();
            }}
            placeholder="Поиск по письмам..."
            className="w-full bg-white placeholder-[#aeaeb2] text-[#1d1d1f] rounded-xl pl-9 pr-9 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-white/60 transition-shadow shadow-sm"
          />
          {searchInput && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors"
            >
              <X size={15} />
            </button>
          )}
        </form>

        <div ref={userMenuRef} className="ml-auto relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-[#e5e5ea] flex items-center justify-center flex-shrink-0 overflow-hidden">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#9e9ea7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
            </div>
            <span className="text-[15px] font-medium text-white hidden sm:block">
              {user?.display_name ?? user?.username}
            </span>
            <ChevronDown size={15} className={`text-white/70 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {userMenuOpen && (
            <div className="animate-dropdown absolute right-0 top-full mt-1.5 bg-white rounded-xl shadow-lg border border-[#f0f0f2] z-50 py-1.5 min-w-[210px]">
              <div className="px-3 py-2.5 border-b border-[#f5f5f7] mb-1">
                <p className="text-sm font-semibold text-[#1d1d1f]">{user?.display_name}</p>
                <p className="text-xs text-muted">{user?.username}</p>
              </div>
              <button
                onClick={() => { setUserSettingsOpen(true); setUserMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
              >
                <User size={15} className="text-muted" />
                Профиль
              </button>
              {user?.is_admin && (
                <button
                  onClick={() => { setAdminOpen(true); setUserMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                >
                  <Settings size={15} className="text-muted" />
                  Настройки
                </button>
              )}
              <button
                onClick={() => { handleLogout(); setUserMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-[#ff3b30] hover:bg-[#f5f5f7] transition-colors"
              >
                <LogOut size={15} />
                Выйти
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-1 min-w-0 px-3 pt-3 pb-3 gap-3 overflow-hidden">
        <div className="w-[30%] flex-shrink-0 bg-white rounded-2xl shadow-card flex flex-col overflow-hidden">
          <Sidebar mailboxes={mailboxes ?? []} />
          {isSearching ? <SearchResults /> : <MessageList />}
        </div>

        <div className="flex-1 min-w-0">
          <MessageViewer />
        </div>
      </div>

      <button
        onClick={() => openCompose()}
        className="fixed bottom-6 right-6 w-14 h-14 bg-accent hover:bg-accent-hover text-white rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95 flex items-center justify-center z-40"
        title="Написать письмо"
      >
        <Plus size={24} />
      </button>

      {composeOpen && <ComposeModal />}
      {adminOpen && <AdminPanel onClose={handleAdminClose} />}
      {userSettingsOpen && <UserSettingsModal onClose={() => setUserSettingsOpen(false)} />}
    </div>
  );
}
