import { useEffect, useRef, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  Paperclip, Star, StarOff, MessageSquare,
  Reply, ReplyAll, Forward, Trash2, ShieldX, FolderInput,
  Mail, MailOpen, ChevronRight,
} from 'lucide-react';
import PostalMime from 'postal-mime';
import { api } from '../api';
import { useStore } from '../store';
import { getFolderLabel } from '../folderUtils';
import type { MessageSummary, ParsedMessage, Folder } from '../types';

const PAGE_SIZE = 50;

function normalizeSubject(subject: string | null): string {
  if (!subject) return '';
  return subject.replace(/^(Re|Fwd|Fw|Ответ|Пересылка):\s*/gi, '').trim().toLowerCase();
}

type Thread = {
  key: string;
  messages: MessageSummary[];
  latest: MessageSummary;
};

function groupIntoThreads(messages: MessageSummary[]): Thread[] {
  const threads = new Map<string, MessageSummary[]>();
  for (const msg of messages) {
    const key = msg.thread_id ?? msg.message_id ?? normalizeSubject(msg.subject) ?? `uid-${msg.uid}`;
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key)!.push(msg);
  }

  const result: Thread[] = [];
  for (const [key, msgs] of threads) {
    const sorted = [...msgs].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
    result.push({ key, messages: sorted, latest: sorted[0] });
  }
  // Sort threads by latest message date
  return result.sort((a, b) => (b.latest.date ?? 0) - (a.latest.date ?? 0));
}

function formatDate(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'вчера';
  if (isThisYear(d)) return format(d, 'd MMM', { locale: ru });
  return format(d, 'd MMM yyyy', { locale: ru });
}

interface CtxMenu { msg: MessageSummary; x: number; y: number; }

export default function MessageList() {
  const { activeMailbox, activeFolder, activeUid, setActiveUid, openCompose } = useStore();
  const qc = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  const { data: folders } = useQuery({
    queryKey: ['folders', activeMailbox?.id],
    queryFn: () => api.getFolders(activeMailbox!.id),
    enabled: !!activeMailbox,
  });

  const currentFolder = folders?.find((f) => f.path === activeFolder);
  const folderTitle = currentFolder
    ? getFolderLabel(currentFolder)
    : activeFolder;

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

  const allMessages = data?.pages.flatMap((p) => p.messages) ?? [];
  const threads = useMemo(() => groupIntoThreads(allMessages), [allMessages]);
  const total = data?.pages[0]?.total ?? 0;
  const syncProgress = data?.pages[0]?.syncProgress ?? null;

  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 84,    // approximate row height in px
    overscan: 8,               // render 8 extra rows above/below viewport
    measureElement: typeof window !== 'undefined'
      ? (el) => el.getBoundingClientRect().height
      : undefined,
  });

  // Poll more frequently while background sync is running
  useEffect(() => {
    if (!syncProgress || !activeMailbox) return;
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, activeFolder] });
    }, 4000);
    return () => clearInterval(interval);
  }, [!!syncProgress, activeMailbox, activeFolder, qc]);

  // Trigger next page when the virtualizer renders items near the end of loaded data
  useEffect(() => {
    const virtualItems = virtualizer.getVirtualItems();
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    if (lastItem.index >= threads.length - 4 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualizer.getVirtualItems(), threads.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

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

  function invalidateLists(extraFolder?: string) {
    qc.invalidateQueries({ queryKey: ['messages', activeMailbox!.id, activeFolder] });
    qc.invalidateQueries({ queryKey: ['folders', activeMailbox!.id] });
    if (extraFolder) qc.invalidateQueries({ queryKey: ['messages', activeMailbox!.id, extraFolder] });
  }

  async function ctxDelete(msg: MessageSummary) {
    setCtxMenu(null);
    await api.deleteMessage(activeMailbox!.id, activeFolder, msg.uid);
    if (activeUid === msg.uid) setActiveUid(null);
    invalidateLists();
  }

  async function ctxFlag(msg: MessageSummary) {
    setCtxMenu(null);
    await api.setFlags(activeMailbox!.id, activeFolder, msg.uid, { flagged: !msg.flagged });
    invalidateLists();
  }

  async function ctxToggleRead(msg: MessageSummary) {
    setCtxMenu(null);
    await api.setFlags(activeMailbox!.id, activeFolder, msg.uid, { seen: !msg.seen });
    invalidateLists();
  }

  async function ctxMove(msg: MessageSummary, toFolder: string) {
    setCtxMenu(null);
    await api.moveMessage(activeMailbox!.id, activeFolder, msg.uid, toFolder);
    if (activeUid === msg.uid) setActiveUid(null);
    invalidateLists(toFolder);
  }

  async function ctxSpam(msg: MessageSummary) {
    const junk = folders?.find((f) => f.specialUse === '\\Junk' || /junk|spam/i.test(f.name));
    if (!junk) return;
    await ctxMove(msg, junk.path);
  }

  async function ctxCompose(msg: MessageSummary, mode: 'reply' | 'replyAll' | 'forward') {
    setCtxMenu(null);
    const raw = await api.getMessage(activeMailbox!.id, activeFolder, msg.uid);
    const binary = atob(raw.source);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const parsed = await PostalMime.parse(bytes.buffer) as unknown as ParsedMessage;
    const fromEntry = Array.isArray(parsed.from) ? parsed.from[0] : (parsed.from as { name?: string; address?: string } | undefined);
    const fromAddr = fromEntry?.address ?? '';
    const fromName = fromEntry?.name ?? '';
    const date = parsed.date ? format(parsed.date, 'd MMMM yyyy, HH:mm', { locale: ru }) : '';
    const quotedText = (parsed.text ?? '').split('\n').map((l) => '> ' + l).join('\n');
    const body = `\n\n---\n${date}, ${fromName || fromAddr}:\n\n${quotedText}`;

    if (mode === 'reply') {
      openCompose({ to: fromAddr, subject: `Re: ${msg.subject ?? ''}`, inReplyTo: msg.message_id ?? undefined, references: msg.message_id ?? undefined, body });
    } else if (mode === 'replyAll') {
      const toAddrs = parsed.to?.map((a) => a.address).filter(Boolean) ?? [];
      const ccAddrs = parsed.cc?.map((a) => a.address).filter(Boolean) ?? [];
      openCompose({ to: [fromAddr, ...toAddrs].filter(Boolean).join(', '), cc: [...new Set(ccAddrs)].join(', '), subject: msg.subject?.startsWith('Re:') ? (msg.subject ?? '') : `Re: ${msg.subject ?? ''}`, inReplyTo: msg.message_id ?? undefined, references: msg.message_id ?? undefined, body });
    } else {
      openCompose({ subject: `Fwd: ${msg.subject ?? ''}`, body });
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#f5f5f7] flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[#1d1d1f]">
            {folderTitle}
          </h2>
          <span className="text-sm text-muted">{total > 0 ? `${total}` : ''}</span>
        </div>
        {syncProgress && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted">Синхронизация писем...</span>
              <span className="text-xs text-muted">
                {Math.round((syncProgress.done / syncProgress.total) * 100)}%
              </span>
            </div>
            <div className="h-1 bg-[#f5f5f7] rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${Math.round((syncProgress.done / syncProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* List — virtualised */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : threads.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[15px] text-muted">
            Нет писем
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const thread = threads[vRow.index];
              return (
                <div
                  key={vRow.key}
                  data-index={vRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <MessageRow
                    msg={thread.latest}
                    threadCount={thread.messages.length}
                    active={thread.messages.some((m) => m.uid === activeUid)}
                    onClick={() => handleSelect(thread.latest)}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ msg: thread.latest, x: e.clientX, y: e.clientY }); }}
                  />
                </div>
              );
            })}
            {isFetchingNextPage && (
              <div
                style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}
                className="h-8 flex items-center justify-center"
              >
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>

      {ctxMenu && (
        <MsgContextMenu
          msg={ctxMenu.msg}
          x={ctxMenu.x}
          y={ctxMenu.y}
          folders={folders ?? []}
          activeFolder={activeFolder}
          onClose={() => setCtxMenu(null)}
          onDelete={ctxDelete}
          onFlag={ctxFlag}
          onToggleRead={ctxToggleRead}
          onMove={ctxMove}
          onSpam={ctxSpam}
          onCompose={ctxCompose}
        />
      )}
    </div>
  );
}

function MessageRow({
  msg,
  threadCount,
  active,
  onClick,
  onContextMenu,
}: {
  msg: MessageSummary;
  threadCount: number;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const unread = !msg.seen;

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`w-full text-left px-4 py-3.5 border-b border-[#f5f5f7] transition-all flex flex-col gap-1 active:scale-[0.99] ${
        active ? 'bg-accent/8' : 'hover:bg-[#fafafa]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {unread && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />}
          <span className={`text-sm truncate ${unread ? 'font-semibold text-[#1d1d1f]' : 'font-medium text-[#3a3a3c]'}`}>
            {msg.from_name || msg.from_addr || 'Неизвестно'}
          </span>
        </div>
        <span className="text-xs text-muted flex-shrink-0">{formatDate(msg.date)}</span>
      </div>

      <span className={`text-sm truncate ${unread ? 'text-[#1d1d1f] font-medium' : 'text-[#3a3a3c]'}`}>
        {msg.subject || '(без темы)'}
      </span>

      <div className="flex items-center gap-1.5">
        {msg.has_attachments ? <Paperclip size={12} className="text-muted" /> : null}
        {msg.flagged ? <Star size={12} className="text-yellow-400 fill-yellow-400" /> : null}
        {threadCount > 1 && (
          <span className="flex items-center gap-0.5 text-xs text-muted">
            <MessageSquare size={11} />
            {threadCount}
          </span>
        )}
        {msg.snippet && (
          <span className="text-xs text-muted truncate">{msg.snippet}</span>
        )}
      </div>
    </button>
  );
}

function MsgContextMenu({
  msg, x, y, folders, activeFolder, onClose,
  onDelete, onFlag, onToggleRead, onMove, onSpam, onCompose,
}: {
  msg: MessageSummary;
  x: number; y: number;
  folders: Folder[];
  activeFolder: string;
  onClose: () => void;
  onDelete: (msg: MessageSummary) => void;
  onFlag: (msg: MessageSummary) => void;
  onToggleRead: (msg: MessageSummary) => void;
  onMove: (msg: MessageSummary, folder: string) => void;
  onSpam: (msg: MessageSummary) => void;
  onCompose: (msg: MessageSummary, mode: 'reply' | 'replyAll' | 'forward') => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showMove, setShowMove] = useState(false);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  // Adjust position so menu doesn't go off-screen
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: Math.min(y, window.innerHeight - 340),
    left: Math.min(x, window.innerWidth - 220),
  };

  const junk = folders.find((f) => f.specialUse === '\\Junk' || /junk|spam/i.test(f.name));
  const moveFolders = folders.filter((f) => f.path !== activeFolder);

  return (
    <div ref={ref} style={style} className="animate-dropdown bg-white rounded-xl shadow-lg border border-[#e5e5ea] py-1.5 min-w-[210px]" onMouseDown={(e) => e.stopPropagation()}>
      {/* Reply group */}
      <MCtxItem icon={<Reply size={14} />} onClick={() => onCompose(msg, 'reply')}>Ответить</MCtxItem>
      <MCtxItem icon={<ReplyAll size={14} />} onClick={() => onCompose(msg, 'replyAll')}>Ответить всем</MCtxItem>
      <MCtxItem icon={<Forward size={14} />} onClick={() => onCompose(msg, 'forward')}>Переслать</MCtxItem>

      <div className="mx-2 my-1 h-px bg-[#f5f5f7]" />

      {/* Read / Flag */}
      <MCtxItem icon={msg.seen ? <Mail size={14} /> : <MailOpen size={14} />} onClick={() => onToggleRead(msg)}>
        {msg.seen ? 'Отметить непрочитанным' : 'Отметить прочитанным'}
      </MCtxItem>
      <MCtxItem icon={msg.flagged ? <StarOff size={14} /> : <Star size={14} />} onClick={() => onFlag(msg)}>
        {msg.flagged ? 'Убрать отметку' : 'Отметить важным'}
      </MCtxItem>

      <div className="mx-2 my-1 h-px bg-[#f5f5f7]" />

      {/* Move */}
      <div className="relative">
        <MCtxItem icon={<FolderInput size={14} />} chevron onClick={() => setShowMove((v) => !v)}>
          Переместить в...
        </MCtxItem>
        {showMove && (
          <div className="mx-2 mb-1 max-h-40 overflow-y-auto rounded-lg bg-[#f5f5f7]">
            {moveFolders.map((f) => (
              <button
                key={f.path}
                onClick={() => onMove(msg, f.path)}
                className="w-full text-left px-3 py-1.5 text-xs text-[#1d1d1f] hover:bg-[#ebebed] transition-colors truncate rounded-lg"
              >
                {getFolderLabel(f)}
              </button>
            ))}
          </div>
        )}
      </div>

      {junk && activeFolder !== junk.path && (
        <MCtxItem icon={<ShieldX size={14} />} onClick={() => onSpam(msg)}>В спам</MCtxItem>
      )}

      <div className="mx-2 my-1 h-px bg-[#f5f5f7]" />

      {/* Delete */}
      <MCtxItem icon={<Trash2 size={14} />} danger onClick={() => onDelete(msg)}>Удалить</MCtxItem>
    </div>
  );
}

function MCtxItem({ icon, children, onClick, danger, chevron }: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  chevron?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-[#f5f5f7] ${danger ? 'text-red-500' : 'text-[#1d1d1f]'}`}
    >
      <span className={danger ? 'text-red-400' : 'text-muted'}>{icon}</span>
      <span className="flex-1 text-left">{children}</span>
      {chevron && <ChevronRight size={13} className="text-muted" />}
    </button>
  );
}
