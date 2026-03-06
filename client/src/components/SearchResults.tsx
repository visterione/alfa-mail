import { useQuery } from '@tanstack/react-query';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import { X, Paperclip } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';

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

  const { data, isLoading } = useQuery({
    queryKey: ['search', activeMailbox?.id, searchQuery],
    queryFn: () => api.search(activeMailbox!.id, searchQuery),
    enabled: !!activeMailbox && searchQuery.length >= 2,
  });

  function clear() {
    setSearchQuery('');
    setIsSearching(false);
  }

  function selectMessage(folder: string, uid: number) {
    setActiveFolder(folder);
    setActiveUid(uid);
    // Don't clear search so user can go back to results
  }

  return (
    <div className="bg-white rounded-2xl shadow-card flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-[#f5f5f7] flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-[#1d1d1f]">Поиск</h2>
          <p className="text-xs text-muted truncate max-w-[180px]">&ldquo;{searchQuery}&rdquo;</p>
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
        ) : !data || data.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted">
            Ничего не найдено
          </div>
        ) : (
          data.map((msg) => (
            <button
              key={`${msg.folder}-${msg.uid}`}
              onClick={() => selectMessage(msg.folder, msg.uid)}
              className="w-full text-left px-4 py-3 border-b border-[#f5f5f7] hover:bg-[#fafafa] transition-colors flex flex-col gap-0.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#1d1d1f] truncate">
                  {msg.from_name || msg.from_addr || 'Неизвестно'}
                </span>
                <span className="text-[10px] text-muted flex-shrink-0">{formatDate(msg.date)}</span>
              </div>
              <span className="text-xs text-[#3a3a3c] truncate">{msg.subject || '(без темы)'}</span>
              <div className="flex items-center gap-1.5">
                {msg.has_attachments ? <Paperclip size={10} className="text-muted" /> : null}
                <span className="text-[10px] text-muted">{msg.folder}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
