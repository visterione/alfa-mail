import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  Reply, ReplyAll, Forward, Trash2, Star, StarOff,
  Paperclip, Download, MoreHorizontal, ArrowLeft,
} from 'lucide-react';
import PostalMime from 'postal-mime';
import { api } from '../api';
import { useStore } from '../store';
import type { ParsedMessage, MessageSummary } from '../types';

export default function MessageViewer() {
  const { activeMailbox, activeFolder, activeUid, setActiveUid, openCompose } = useStore();
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<ParsedMessage | null>(null);
  const [parseError, setParseError] = useState(false);

  const { data: msgFull, isLoading } = useQuery({
    queryKey: ['message', activeMailbox?.id, activeFolder, activeUid],
    queryFn: () => api.getMessage(activeMailbox!.id, activeFolder, activeUid!),
    enabled: !!activeMailbox && !!activeUid,
    staleTime: Infinity,
  });

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
  }

  async function handleFlag() {
    if (!activeMailbox || !activeUid || !summary) return;
    await api.setFlags(activeMailbox.id, activeFolder, activeUid, { flagged: !summary.flagged });
    qc.invalidateQueries({ queryKey: ['messages', activeMailbox.id, activeFolder] });
  }

  function handleReply() {
    if (!parsed || !summary) return;
    const replyTo = parsed.from?.[0]?.address ?? '';
    openCompose({
      to: replyTo,
      subject: `Re: ${summary.subject ?? ''}`,
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
          <p className="text-sm text-muted">Выберите письмо</p>
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
          className="p-1.5 rounded-lg hover:bg-[#f5f5f7] text-muted transition-colors mr-1"
          title="Назад"
        >
          <ArrowLeft size={15} />
        </button>

        <div className="flex items-center gap-1 flex-1">
          <ToolBtn onClick={handleReply} title="Ответить"><Reply size={15} /></ToolBtn>
          <ToolBtn onClick={handleReply} title="Ответить всем"><ReplyAll size={15} /></ToolBtn>
          <ToolBtn onClick={handleForward} title="Переслать"><Forward size={15} /></ToolBtn>
        </div>

        <div className="flex items-center gap-1">
          <ToolBtn onClick={handleFlag} title={summary?.flagged ? 'Убрать отметку' : 'Отметить'}>
            {summary?.flagged
              ? <Star size={15} className="text-yellow-400 fill-yellow-400" />
              : <StarOff size={15} />}
          </ToolBtn>
          <ToolBtn onClick={handleDelete} title="Удалить"><Trash2 size={15} /></ToolBtn>
        </div>
      </div>

      {/* Message header */}
      <div className="px-6 py-4 border-b border-[#f5f5f7] flex-shrink-0">
        <h1 className="text-lg font-semibold text-[#1d1d1f] leading-snug mb-3">
          {summary?.subject || '(без темы)'}
        </h1>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
            {(parsed.from?.[0]?.name ?? parsed.from?.[0]?.address ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#1d1d1f]">
                {parsed.from?.[0]?.name || parsed.from?.[0]?.address}
              </span>
              {parsed.from?.[0]?.name && (
                <span className="text-xs text-muted">&lt;{parsed.from[0].address}&gt;</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-muted">
                Кому: {parsed.to?.map((a) => a.name || a.address).join(', ')}
              </span>
              {summary?.date && (
                <span className="text-xs text-muted">
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
          <pre className="text-xs text-muted whitespace-pre-wrap font-mono">
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
          <pre className="text-sm text-[#1d1d1f] whitespace-pre-wrap leading-relaxed font-sans">
            {parsed.text}
          </pre>
        )}
      </div>

      {/* Attachments */}
      {parsed.attachments && parsed.attachments.length > 0 && (
        <div className="px-6 py-3 border-t border-[#f5f5f7] flex-shrink-0">
          <p className="text-xs font-medium text-muted mb-2">Вложения</p>
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
      <Paperclip size={13} className="text-muted flex-shrink-0" />
      <div>
        <p className="text-xs font-medium text-[#1d1d1f] max-w-[160px] truncate">{name}</p>
        {size && <p className="text-[10px] text-muted">{formatBytes(size)}</p>}
      </div>
      <Download size={12} className="text-muted ml-1" />
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function buildQuote(msg: ParsedMessage): string {
  const from = msg.from?.[0]?.name ?? msg.from?.[0]?.address ?? '';
  const date = msg.date ? format(msg.date, 'd MMMM yyyy, HH:mm', { locale: ru }) : '';
  const text = msg.text ?? '';
  return `\n\n---\n${date}, ${from}:\n\n${text.split('\n').map((l) => '> ' + l).join('\n')}`;
}
