import { useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import { X, Paperclip } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';

const PAGE_SIZE = 50;

function formatDate(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'вчера';
  if (isThisYear(d)) return format(d, 'd MMM', { locale: ru });
  return format(d, 'd MMM yyyy', { locale: ru });
}

export default function SearchResults() {
  const { activeMailbox, searchQuery, setSearchQuery, setIsSearching, setActiveUid, setActiveFolder } = useStore();
  const loaderRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['search', activeMailbox?.id, searchQuery],
    queryFn: ({ pageParam = 1, signal }) =>
      api.search(activeMailbox!.id, searchQuery, undefined, pageParam, PAGE_SIZE, signal),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.length * PAGE_SIZE;
      return loaded < lastPage.total ? pages.length + 1 : undefined;
    },
    initialPageParam: 1,
    enabled: !!activeMailbox && searchQuery.length >= 2,
  });

  // Infinite scroll
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  function clear() {
    setSearchQuery('');
    setIsSearching(false);
  }

  function selectMessage(folder: string, uid: number) {
    setActiveFolder(folder);
    setActiveUid(uid);
  }

  const allMessages = data?.pages.flatMap((p) => p.messages) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-4 py-3 border-b border-[#f5f5f7] flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Поиск</h2>
          <p className="text-sm text-muted truncate max-w-[180px]">
            &ldquo;{searchQuery}&rdquo;{total > 0 ? ` — ${total}` : ''}
          </p>
        </div>
        <button onClick={clear} className="p-1.5 rounded-lg hover:bg-[#f5f5f7] text-muted transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : allMessages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[15px] text-muted">
            Ничего не найдено
          </div>
        ) : (
          <>
            {allMessages.map((msg) => (
              <button
                key={`${msg.folder}-${msg.uid}`}
                onClick={() => selectMessage(msg.folder, msg.uid)}
                className="w-full text-left px-4 py-3 border-b border-[#f5f5f7] hover:bg-[#fafafa] transition-colors flex flex-col gap-0.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[#1d1d1f] truncate">
                    {msg.from_name || msg.from_addr || 'Неизвестно'}
                  </span>
                  <span className="text-xs text-muted flex-shrink-0">{formatDate(msg.date)}</span>
                </div>
                <span className="text-sm text-[#3a3a3c] truncate">{msg.subject || '(без темы)'}</span>
                <div className="flex items-center gap-1.5">
                  {msg.has_attachments ? <Paperclip size={12} className="text-muted" /> : null}
                  <span className="text-xs text-muted">{msg.folder}</span>
                </div>
              </button>
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
