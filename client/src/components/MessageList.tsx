import { useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Paperclip, Star } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import type { MessageSummary } from '../types';

const PAGE_SIZE = 50;

function formatDate(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'вчера';
  if (isThisYear(d)) return format(d, 'd MMM', { locale: ru });
  return format(d, 'd MMM yyyy', { locale: ru });
}

export default function MessageList() {
  const { activeMailbox, activeFolder, activeUid, setActiveUid } = useStore();
  const qc = useQueryClient();
  const loaderRef = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['messages', activeMailbox?.id, activeFolder],
    queryFn: ({ pageParam = 1 }) =>
      api.getMessages(activeMailbox!.id, activeFolder, pageParam, PAGE_SIZE),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.length * PAGE_SIZE;
      return loaded < lastPage.total ? pages.length + 1 : undefined;
    },
    initialPageParam: 1,
    enabled: !!activeMailbox,
  });

  const messages = data?.pages.flatMap((p) => p.messages) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  // Infinite scroll
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  // Auto-sync every 60s
  useEffect(() => {
    if (!activeMailbox) return;
    const interval = setInterval(() => {
      api
        .syncFolder(activeMailbox.id, activeFolder)
        .then(() =>
          qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, activeFolder] })
        )
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeMailbox, activeFolder, qc]);

  async function handleSelect(msg: MessageSummary) {
    setActiveUid(msg.uid);
    if (!msg.seen) {
      // Optimistic update
      qc.setQueryData<typeof data>(['messages', activeMailbox?.id, activeFolder], (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: page.messages.map((m) =>
              m.uid === msg.uid ? { ...m, seen: 1 } : m
            ),
          })),
        };
      });
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-card flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#f5f5f7] flex items-center justify-between flex-shrink-0">
        <h2 className="text-sm font-semibold text-[#1d1d1f]">
          {activeFolder === 'INBOX' ? 'Входящие' : activeFolder}
        </h2>
        <span className="text-xs text-muted">{total > 0 ? `${total}` : ''}</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted">
            Нет писем
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageRow
                key={msg.uid}
                msg={msg}
                active={activeUid === msg.uid}
                onClick={() => handleSelect(msg)}
              />
            ))}
            <div ref={loaderRef} className="h-4 flex items-center justify-center">
              {isFetchingNextPage && (
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MessageRow({
  msg,
  active,
  onClick,
}: {
  msg: MessageSummary;
  active: boolean;
  onClick: () => void;
}) {
  const unread = !msg.seen;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-[#f5f5f7] transition-colors flex flex-col gap-0.5 ${
        active ? 'bg-accent/8' : 'hover:bg-[#fafafa]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {unread && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />}
          <span className={`text-xs truncate ${unread ? 'font-semibold text-[#1d1d1f]' : 'font-medium text-[#3a3a3c]'}`}>
            {msg.from_name || msg.from_addr || 'Неизвестно'}
          </span>
        </div>
        <span className="text-[10px] text-muted flex-shrink-0">{formatDate(msg.date)}</span>
      </div>

      <span className={`text-xs truncate ${unread ? 'text-[#1d1d1f] font-medium' : 'text-[#3a3a3c]'}`}>
        {msg.subject || '(без темы)'}
      </span>

      <div className="flex items-center gap-1.5">
        {msg.has_attachments ? <Paperclip size={10} className="text-muted" /> : null}
        {msg.flagged ? <Star size={10} className="text-yellow-400 fill-yellow-400" /> : null}
        {msg.snippet && (
          <span className="text-[10px] text-muted truncate">{msg.snippet}</span>
        )}
      </div>
    </button>
  );
}
