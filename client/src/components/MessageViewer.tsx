import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  Reply, ReplyAll, Forward, Trash2, Star, StarOff,
  Paperclip, Download, ArrowLeft, FolderInput, ShieldX,
} from 'lucide-react';
import PostalMime from 'postal-mime';
import { api } from '../api';
import { useStore } from '../store';
import { getFolderLabel } from '../folderUtils';
import type { ParsedMessage, MessageSummary } from '../types';

function getFrom(parsed: ParsedMessage) {
  // PostalMime may return `from` as a single object or as an array
  const entry = Array.isArray(parsed.from) ? parsed.from[0] : parsed.from as unknown as { name?: string; address?: string } | undefined;
  return { name: entry?.name ?? '', address: entry?.address ?? '' };
}

function AvatarLetter({ text }: { text: string }) {
  const letter = text.trim().charAt(0).toUpperCase();
  if (letter) {
    return <>{letter}</>;
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  );
}

export default function MessageViewer() {
  const { activeMailbox, activeFolder, activeUid, setActiveUid, openCompose } = useStore();
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<ParsedMessage | null>(null);
  const [parseError, setParseError] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement>(null);

  const { data: msgFull, isLoading } = useQuery({
    queryKey: ['message', activeMailbox?.id, activeFolder, activeUid],
    queryFn: () => api.getMessage(activeMailbox!.id, activeFolder, activeUid!),
    enabled: !!activeMailbox && !!activeUid,
    staleTime: Infinity,
  });

  const { data: folders } = useQuery({
    queryKey: ['folders', activeMailbox?.id],
    queryFn: () => api.getFolders(activeMailbox!.id),
    enabled: !!activeMailbox,
    staleTime: 5 * 60 * 1000,
  });

  // Close move menu on outside click
  useEffect(() => {
    if (!showMoveMenu) return;
    const close = (e: MouseEvent) => {
      if (!moveMenuRef.current?.contains(e.target as Node)) setShowMoveMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showMoveMenu]);

  // Get cached summary for flags
  const summaries = qc.getQueryData<{ pages: { messages: MessageSummary[] }[] }>([
    'messages',
    activeMailbox?.id,
    activeFolder,
  ]);
  const summary = summaries?.pages.flatMap((p) => p.messages).find((m) => m.uid === activeUid);

  useEffect(() => {
    if (!msgFull) { setParsed(null); return; }
    setParseError(false);
    const binary = atob(msgFull.source);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    PostalMime.parse(bytes.buffer)
      .then((mail) => setParsed(mail as unknown as ParsedMessage))
      .catch(() => { setParseError(true); });
  }, [msgFull]);

  async function handleDelete() {
    if (!activeMailbox || !activeUid) return;
    await api.deleteMessage(activeMailbox.id, activeFolder, activeUid);
    setActiveUid(null);
    qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, activeFolder] });
    qc.invalidateQueries({ queryKey: ['folders', activeMailbox.id] });
  }

  async function handleMove(toFolder: string) {
    if (!activeMailbox || !activeUid) return;
    setShowMoveMenu(false);
    await api.moveMessage(activeMailbox.id, activeFolder, activeUid, toFolder);
    setActiveUid(null);
    qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, activeFolder] });
    qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, toFolder] });
    qc.invalidateQueries({ queryKey: ['folders', activeMailbox.id] });
  }

  async function handleSpam() {
    if (!folders) return;
    const junk = folders.find((f) =>
      f.specialUse === '\\Junk' || /junk|spam/i.test(f.name)
    );
    if (!junk) return;
    await handleMove(junk.path);
  }

  async function handleFlag() {
    if (!activeMailbox || !activeUid || !summary) return;
    await api.setFlags(activeMailbox.id, activeFolder, activeUid, { flagged: !summary.flagged });
    qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, activeFolder] });
  }

  function handleReply() {
    if (!parsed || !summary) return;
    const { address: replyTo } = getFrom(parsed);
    openCompose({
      to: replyTo,
      subject: `Re: ${summary.subject ?? ''}`,
      inReplyTo: summary.message_id ?? undefined,
      references: summary.message_id ?? undefined,
      body: buildQuote(parsed),
    });
  }

  function handleReplyAll() {
    if (!parsed || !summary) return;
    const { address: fromAddr } = getFrom(parsed);
    const toAddrs = parsed.to?.map((a) => a.address).filter(Boolean) ?? [];
    const ccAddrs = parsed.cc?.map((a) => a.address).filter(Boolean) ?? [];
    const allTo = [fromAddr, ...toAddrs].filter(Boolean);
    const uniqueTo = [...new Set(allTo)].join(', ');
    const uniqueCc = [...new Set(ccAddrs)].join(', ');
    openCompose({
      to: uniqueTo,
      cc: uniqueCc,
      subject: summary.subject?.startsWith('Re:') ? (summary.subject ?? '') : `Re: ${summary.subject ?? ''}`,
      inReplyTo: summary.message_id ?? undefined,
      references: summary.message_id ?? undefined,
      body: buildQuote(parsed),
    });
  }

  function handleForward() {
    if (!parsed || !summary) return;
    openCompose({
      subject: `Fwd: ${summary.subject ?? ''}`,
      body: buildQuote(parsed),
    });
  }

  if (!activeUid) {
    return (
      <div className="bg-white rounded-2xl shadow-card h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#f5f5f7] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M3 8l9 6 9-6" stroke="#aeaeb2" strokeWidth="2" strokeLinecap="round"/>
              <rect x="3" y="6" width="18" height="13" rx="2" stroke="#aeaeb2" strokeWidth="2"/>
            </svg>
          </div>
          <p className="text-[15px] text-muted">Выберите письмо</p>
        </div>
      </div>
    );
  }

  if (isLoading || !parsed) {
    return (
      <div className="bg-white rounded-2xl shadow-card h-full flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-card h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-[#f5f5f7] flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setActiveUid(null)}
          className="p-2 rounded-lg hover:bg-[#f5f5f7] text-muted transition-colors mr-1"
          title="Назад"
        >
          <ArrowLeft size={17} />
        </button>

        <div className="flex items-center gap-1 flex-1">
          <ToolBtn onClick={handleReply} title="Ответить"><Reply size={17} /></ToolBtn>
          <ToolBtn onClick={handleReplyAll} title="Ответить всем"><ReplyAll size={17} /></ToolBtn>
          <ToolBtn onClick={handleForward} title="Переслать"><Forward size={17} /></ToolBtn>
        </div>

        <div className="flex items-center gap-1">
          {/* Move to folder */}
          <div className="relative" ref={moveMenuRef}>
            <ToolBtn onClick={() => setShowMoveMenu((v) => !v)} title="Переместить в папку">
              <FolderInput size={17} />
            </ToolBtn>
            {showMoveMenu && folders && (
              <div className="absolute top-full right-0 mt-1 bg-white rounded-xl shadow-lg border border-[#e5e5ea] py-1 z-50 min-w-[190px] max-h-60 overflow-y-auto">
                {folders
                  .filter((f) => f.path !== activeFolder)
                  .map((f) => (
                    <button
                      key={f.path}
                      onClick={() => handleMove(f.path)}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-[#f5f5f7] transition-colors text-[#1d1d1f] truncate"
                    >
                      {getFolderLabel(f)}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Mark as spam */}
          {folders?.some((f) => f.specialUse === '\\Junk' || /junk|spam/i.test(f.name)) &&
            activeFolder !== (folders.find((f) => f.specialUse === '\\Junk' || /junk|spam/i.test(f.name))?.path) && (
            <ToolBtn onClick={handleSpam} title="В спам">
              <ShieldX size={17} />
            </ToolBtn>
          )}

          <ToolBtn onClick={handleFlag} title={summary?.flagged ? 'Убрать отметку' : 'Отметить'}>
            {summary?.flagged
              ? <Star size={17} className="text-yellow-400 fill-yellow-400" />
              : <StarOff size={17} />}
          </ToolBtn>
          <ToolBtn onClick={handleDelete} title="Удалить"><Trash2 size={17} /></ToolBtn>
        </div>
      </div>

      {/* Message header */}
      <div className="px-6 py-4 border-b border-[#f5f5f7] flex-shrink-0">
        <h1 className="text-xl font-semibold text-[#1d1d1f] leading-snug mb-3">
          {summary?.subject || '(без темы)'}
        </h1>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white text-base font-semibold flex-shrink-0">
            <AvatarLetter text={getFrom(parsed).name || getFrom(parsed).address} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-medium text-[#1d1d1f]">
                {getFrom(parsed).name || getFrom(parsed).address || 'Неизвестно'}
              </span>
              {getFrom(parsed).name && getFrom(parsed).address && (
                <span className="text-sm text-muted">&lt;{getFrom(parsed).address}&gt;</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-0.5">
              <span className="text-sm text-muted">
                Кому: {parsed.to?.map((a) => a.name || a.address).join(', ')}
              </span>
              {parsed.cc && parsed.cc.length > 0 && (
                <span className="text-sm text-muted">
                  Копия: {parsed.cc.map((a) => a.name || a.address).join(', ')}
                </span>
              )}
              {summary?.date && (
                <span className="text-sm text-muted">
                  {format(new Date(summary.date * 1000), 'd MMMM yyyy, HH:mm', { locale: ru })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {parseError ? (
          <pre className="text-sm text-muted whitespace-pre-wrap font-mono">
            Не удалось отобразить письмо
          </pre>
        ) : parsed.html ? (
          <iframe
            srcDoc={parsed.html}
            className="w-full border-0"
            style={{ minHeight: '400px' }}
            sandbox="allow-same-origin"
            onLoad={(e) => {
              const iframe = e.currentTarget;
              iframe.style.height = ((iframe.contentDocument?.body?.scrollHeight ?? 400) + 32) + 'px';
            }}
          />
        ) : (
          <pre className="text-[15px] text-[#1d1d1f] whitespace-pre-wrap leading-relaxed font-sans">
            {parsed.text}
          </pre>
        )}
      </div>

      {/* Attachments */}
      {parsed.attachments && parsed.attachments.length > 0 && (
        <div className="px-6 py-3 border-t border-[#f5f5f7] flex-shrink-0">
          <p className="text-sm font-medium text-muted mb-2">Вложения</p>
          <div className="flex flex-wrap gap-2">
            {parsed.attachments.map((att, i) => (
              <AttachmentChip key={i} name={att.filename ?? `file-${i + 1}`} size={att.size} content={att.content} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-lg hover:bg-[#f5f5f7] text-muted hover:text-[#1d1d1f] transition-colors"
    >
      {children}
    </button>
  );
}

function AttachmentChip({ name, size, content }: { name: string; size?: number; content?: Uint8Array | string | ArrayBuffer }) {
  function download() {
    if (!content) return;
    let blobData: BlobPart;
    if (content instanceof Uint8Array) blobData = new Uint8Array(content);
    else if (typeof content === 'string') blobData = content;
    else blobData = new Uint8Array(content as ArrayBuffer);
    const blob = new Blob([blobData]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      className="flex items-center gap-2 px-3 py-2 bg-[#f5f5f7] hover:bg-[#ebebed] rounded-xl transition-colors text-left"
    >
      <Paperclip size={15} className="text-muted flex-shrink-0" />
      <div>
        <p className="text-sm font-medium text-[#1d1d1f] max-w-[200px] truncate">{name}</p>
        {size && <p className="text-xs text-muted">{formatBytes(size)}</p>}
      </div>
      <Download size={14} className="text-muted ml-1" />
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function buildQuote(msg: ParsedMessage): string {
  const { name, address } = getFrom(msg);
  const from = name || address;
  const date = msg.date ? format(msg.date, 'd MMMM yyyy, HH:mm', { locale: ru }) : '';
  const text = msg.text ?? '';
  return `\n\n---\n${date}, ${from}:\n\n${text.split('\n').map((l) => '> ' + l).join('\n')}`;
}
