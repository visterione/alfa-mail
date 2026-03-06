import { useRef, useState } from 'react';
import { X, Paperclip, Send, Trash2, AlertCircle } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api';

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB

interface AttachFile {
  file: File;
  isLarge: boolean;
}

export default function ComposeModal() {
  const { closeCompose, composeDefaults, activeMailbox } = useStore();
  const [to, setTo] = useState(composeDefaults.to ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(composeDefaults.subject ?? '');
  const [body, setBody] = useState(composeDefaults.body ?? '');
  const [attachments, setAttachments] = useState<AttachFile[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showCc, setShowCc] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const newFiles = Array.from(files).map((f) => ({
      file: f,
      isLarge: f.size >= LARGE_FILE_THRESHOLD,
    }));
    setAttachments((a) => [...a, ...newFiles]);
  }

  function removeAttachment(i: number) {
    setAttachments((a) => a.filter((_, idx) => idx !== i));
  }

  async function handleSend() {
    if (!activeMailbox) return;
    if (!to.trim()) { setError('Укажите получателя'); return; }
    if (!subject.trim()) { setError('Укажите тему'); return; }

    setSending(true);
    setError('');

    const form = new FormData();
    form.append('to', to);
    if (cc) form.append('cc', cc);
    form.append('subject', subject);
    form.append('text', body);
    if (composeDefaults.inReplyTo) form.append('inReplyTo', composeDefaults.inReplyTo);
    if (composeDefaults.references) form.append('references', composeDefaults.references);

    for (const att of attachments) {
      form.append('file', att.file, att.file.name);
    }

    try {
      await api.sendMail(activeMailbox.id, form);
      closeCompose();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Ошибка отправки';
      setError(msg);
    } finally {
      setSending(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none">
      <div
        className="pointer-events-auto bg-white rounded-2xl shadow-panel w-full max-w-xl flex flex-col"
        style={{ maxHeight: '80vh' }}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f5f5f7] flex-shrink-0">
          <h2 className="text-sm font-semibold text-[#1d1d1f]">Новое письмо</h2>
          <button onClick={closeCompose} className="p-1 rounded-lg hover:bg-[#f5f5f7] text-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Fields */}
        <div className="flex-shrink-0">
          <div className="flex items-center border-b border-[#f5f5f7] px-5">
            <span className="text-xs text-muted w-12 flex-shrink-0">Кому</span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="email@example.com"
              className="flex-1 py-2.5 text-sm outline-none placeholder:text-[#aeaeb2]"
            />
            {!showCc && (
              <button onClick={() => setShowCc(true)} className="text-xs text-accent">Копия</button>
            )}
          </div>

          {showCc && (
            <div className="flex items-center border-b border-[#f5f5f7] px-5">
              <span className="text-xs text-muted w-12 flex-shrink-0">Копия</span>
              <input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="email@example.com"
                className="flex-1 py-2.5 text-sm outline-none placeholder:text-[#aeaeb2]"
              />
            </div>
          )}

          <div className="flex items-center border-b border-[#f5f5f7] px-5">
            <span className="text-xs text-muted w-12 flex-shrink-0">Тема</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Тема письма"
              className="flex-1 py-2.5 text-sm outline-none placeholder:text-[#aeaeb2]"
            />
          </div>
        </div>

        {/* Body */}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Текст письма..."
          className="flex-1 px-5 py-3 text-sm outline-none resize-none min-h-[200px] placeholder:text-[#aeaeb2] leading-relaxed"
        />

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="px-5 pb-2 flex flex-wrap gap-2 flex-shrink-0">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-[#f5f5f7] rounded-xl px-2.5 py-1.5"
              >
                {att.isLarge && (
                  <span title="Файл будет загружен в облако">
                    <AlertCircle size={11} className="text-accent" />
                  </span>
                )}
                <Paperclip size={11} className="text-muted" />
                <span className="text-xs text-[#1d1d1f] max-w-[120px] truncate">{att.file.name}</span>
                <span className="text-[10px] text-muted">{formatBytes(att.file.size)}</span>
                <button onClick={() => removeAttachment(i)} className="text-muted hover:text-red-500 transition-colors">
                  <X size={11} />
                </button>
              </div>
            ))}
            {attachments.some((a) => a.isLarge) && (
              <p className="w-full text-[10px] text-muted flex items-center gap-1">
                <AlertCircle size={10} className="text-accent" />
                Файлы &gt;10 МБ будут автоматически загружены в Nextcloud и заменены ссылкой
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="mx-5 mb-2 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#f5f5f7] flex-shrink-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileRef.current?.click()}
              className="p-2 rounded-xl hover:bg-[#f5f5f7] text-muted transition-colors"
              title="Прикрепить файл"
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={closeCompose}
              className="p-2 rounded-xl hover:bg-[#f5f5f7] text-muted transition-colors"
              title="Отменить"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={handleSend}
              disabled={sending}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
            >
              <Send size={14} />
              {sending ? 'Отправка...' : 'Отправить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
