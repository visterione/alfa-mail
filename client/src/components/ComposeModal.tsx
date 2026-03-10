import { useRef, useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  X, Paperclip, Send, Trash2, ChevronDown,
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Link as LinkIcon, Undo2, Redo2, RemoveFormatting,
} from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api';
import type { Contact } from '../types';

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB
const DRAFT_SAVE_INTERVAL = 30_000; // 30 seconds

interface AttachFile {
  file: File;
  isLarge: boolean;
}

function buildSignatureHtml(signature: string, logo: string): string {
  const logoHtml = logo
    ? `<img src="${logo}" style="max-height:64px;max-width:200px;display:block;margin-bottom:8px;" alt="">`
    : '';
  const FONT = `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
  const safe = signature.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const textHtml = safe
    ? `<div style="font-family:${FONT};font-size:13px;color:#3c3c43;line-height:1.6;">${safe.replace(/\n/g, '<br>')}</div>`
    : '';
  return logoHtml + textHtml;
}

function getLastToken(value: string): string {
  const parts = value.split(',');
  return parts[parts.length - 1].trim();
}

function appendContact(current: string, contact: Contact): string {
  const parts = current.split(',').map((s) => s.trim()).filter(Boolean);
  parts.pop();
  const label = contact.name ? `${contact.name} <${contact.email}>` : contact.email;
  parts.push(label);
  return parts.join(', ') + ', ';
}

// Strip HTML tags to plain text for the text/plain fallback
function htmlToPlainText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

export default function ComposeModal() {
  const { closeCompose, composeDefaults, activeMailbox } = useStore();

  const { data: settings } = useQuery({
    queryKey: ['mailbox-signature', activeMailbox?.id],
    queryFn: () => api.getMailboxSignature(activeMailbox!.id),
    enabled: !!activeMailbox,
    staleTime: 5 * 60 * 1000,
  });

  const [to, setTo] = useState(composeDefaults.to ?? '');
  const [cc, setCc] = useState(composeDefaults.cc ?? '');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(composeDefaults.subject ?? '');
  const [attachments, setAttachments] = useState<AttachFile[]>([]);
  const [error, setError] = useState('');
  const [showCc, setShowCc] = useState(!!(composeDefaults.cc));
  const [showBcc, setShowBcc] = useState(false);

  // Contact autocomplete
  const [toSuggestions, setToSuggestions] = useState<Contact[]>([]);
  const [ccSuggestions, setCcSuggestions] = useState<Contact[]>([]);
  const [bccSuggestions, setBccSuggestions] = useState<Contact[]>([]);
  const toDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ccDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bccDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toWrapRef = useRef<HTMLDivElement>(null);
  const ccWrapRef = useRef<HTMLDivElement>(null);
  const bccWrapRef = useRef<HTMLDivElement>(null);

  // Draft tracking
  const draftIdRef = useRef<number | undefined>(composeDefaults.draftId ?? undefined);
  const sentSuccessfully = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Convert initial plain-text body to basic HTML
  const initialContent = composeDefaults.body
    ? composeDefaults.body.startsWith('<')
      ? composeDefaults.body
      : composeDefaults.body.split('\n').map((l) => `<p>${l || '<br>'}</p>`).join('')
    : '';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Underline,
      TextStyle,
      Color,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Текст письма...' }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'prose-editor outline-none',
        style: 'min-height:120px;padding:12px 20px;font-size:14px;line-height:1.6;color:#1d1d1f;',
      },
    },
  });

  const signatureHtml = settings
    ? buildSignatureHtml(settings.signature, settings.signature_logo ?? '')
    : '';

  // --- Draft auto-save ---
  const saveDraft = useCallback(async () => {
    if (!activeMailbox) return;
    try {
      const result = await api.saveDraft({
        id: draftIdRef.current,
        mailbox_id: activeMailbox.id,
        to_addr: to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        body: editor?.getHTML() ?? '',
        in_reply_to: composeDefaults.inReplyTo,
        references_header: composeDefaults.references,
      });
      draftIdRef.current = result.id;
    } catch {
      // Draft save failure is silent
    }
  }, [activeMailbox, to, cc, bcc, subject, editor, composeDefaults.inReplyTo, composeDefaults.references]);

  useEffect(() => {
    const id = setInterval(saveDraft, DRAFT_SAVE_INTERVAL);
    return () => clearInterval(id);
  }, [saveDraft]);

  useEffect(() => {
    return () => {
      if (sentSuccessfully.current && draftIdRef.current) {
        api.deleteDraft(draftIdRef.current).catch(() => {});
      }
    };
  }, []);

  // --- Contact autocomplete helpers ---
  function searchContacts(
    query: string,
    setSuggestions: (c: Contact[]) => void,
    debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  ) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const token = getLastToken(query);
    if (token.length < 1) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.searchContacts(token);
        setSuggestions(results.slice(0, 8));
      } catch { setSuggestions([]); }
    }, 200);
  }

  function handleToChange(val: string) { setTo(val); searchContacts(val, setToSuggestions, toDebounceRef); }
  function handleCcChange(val: string) { setCc(val); searchContacts(val, setCcSuggestions, ccDebounceRef); }
  function handleBccChange(val: string) { setBcc(val); searchContacts(val, setBccSuggestions, bccDebounceRef); }
  function pickToContact(c: Contact) { setTo(appendContact(to, c)); setToSuggestions([]); }
  function pickCcContact(c: Contact) { setCc(appendContact(cc, c)); setCcSuggestions([]); }
  function pickBccContact(c: Contact) { setBcc(appendContact(bcc, c)); setBccSuggestions([]); }

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (toWrapRef.current && !toWrapRef.current.contains(e.target as Node)) setToSuggestions([]);
      if (ccWrapRef.current && !ccWrapRef.current.contains(e.target as Node)) setCcSuggestions([]);
      if (bccWrapRef.current && !bccWrapRef.current.contains(e.target as Node)) setBccSuggestions([]);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // --- File handling ---
  function handleFiles(files: FileList | null) {
    if (!files) return;
    setAttachments((a) => [...a, ...Array.from(files).map((f) => ({ file: f, isLarge: f.size >= LARGE_FILE_THRESHOLD }))]);
  }
  function removeAttachment(i: number) { setAttachments((a) => a.filter((_, idx) => idx !== i)); }
  function handleDrop(e: React.DragEvent) { e.preventDefault(); handleFiles(e.dataTransfer.files); }

  // --- Send ---
  function handleSend() {
    if (!activeMailbox) return;
    if (!to.trim()) { setError('Укажите получателя'); return; }
    if (!subject.trim()) { setError('Укажите тему'); return; }

    const htmlContent = editor?.getHTML() ?? '';
    const textContent = htmlToPlainText(htmlContent);

    const form = new FormData();
    form.append('to', to);
    if (cc) form.append('cc', cc);
    if (bcc) form.append('bcc', bcc);
    form.append('subject', subject);
    form.append('html', htmlContent);
    form.append('text', textContent);
    if (composeDefaults.inReplyTo) form.append('inReplyTo', composeDefaults.inReplyTo);
    if (composeDefaults.references) form.append('references', composeDefaults.references);
    if (signatureHtml) form.append('signatureHtml', signatureHtml);

    for (const att of attachments) {
      form.append('file', att.file, att.file.name);
    }

    sentSuccessfully.current = true;
    closeCompose();
    api.sendMail(activeMailbox.id, form, () => {}).catch(() => {});
  }

  // --- Discard draft ---
  async function handleDiscard() {
    if (draftIdRef.current) {
      try { await api.deleteDraft(draftIdRef.current); draftIdRef.current = undefined; } catch { /* ignore */ }
    }
    closeCompose();
  }

  const isReply = !!(composeDefaults.inReplyTo);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end p-4 pointer-events-none">
      <div
        className="animate-modal pointer-events-auto bg-white rounded-2xl shadow-panel w-full max-w-xl flex flex-col"
        style={{ maxHeight: '85vh' }}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f5f5f7] flex-shrink-0">
          <h2 className="text-sm font-semibold text-[#1d1d1f]">
            {isReply ? 'Ответить' : 'Новое письмо'}
          </h2>
          <button onClick={closeCompose} className="p-1 rounded-lg hover:bg-[#f5f5f7] text-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Fields */}
        <div className="flex-shrink-0">
          {/* To */}
          <div ref={toWrapRef} className="relative">
            <div className="flex items-center border-b border-[#f5f5f7] px-5">
              <span className="text-xs text-muted w-12 flex-shrink-0">Кому</span>
              <input
                value={to}
                onChange={(e) => handleToChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setToSuggestions([])}
                placeholder="email@example.com"
                className="flex-1 py-2.5 text-sm outline-none placeholder:text-[#aeaeb2]"
              />
              <div className="flex items-center gap-2 flex-shrink-0">
                {!showCc && <button onClick={() => setShowCc(true)} className="text-xs text-accent hover:underline">Копия</button>}
                {!showBcc && <button onClick={() => setShowBcc(true)} className="text-xs text-accent hover:underline">СКК</button>}
              </div>
            </div>
            {toSuggestions.length > 0 && <SuggestionDropdown suggestions={toSuggestions} onPick={pickToContact} />}
          </div>

          {/* CC */}
          {showCc && (
            <div ref={ccWrapRef} className="relative">
              <div className="flex items-center border-b border-[#f5f5f7] px-5">
                <span className="text-xs text-muted w-12 flex-shrink-0">Копия</span>
                <input value={cc} onChange={(e) => handleCcChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCcSuggestions([])} placeholder="email@example.com" className="flex-1 py-2.5 text-sm outline-none placeholder:text-[#aeaeb2]" />
                <button onClick={() => { setShowCc(false); setCc(''); setCcSuggestions([]); }} className="p-1 rounded hover:bg-[#f5f5f7] text-muted transition-colors flex-shrink-0"><X size={12} /></button>
              </div>
              {ccSuggestions.length > 0 && <SuggestionDropdown suggestions={ccSuggestions} onPick={pickCcContact} />}
            </div>
          )}

          {/* BCC */}
          {showBcc && (
            <div ref={bccWrapRef} className="relative">
              <div className="flex items-center border-b border-[#f5f5f7] px-5">
                <span className="text-xs text-muted w-12 flex-shrink-0">СКК</span>
                <input value={bcc} onChange={(e) => handleBccChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setBccSuggestions([])} placeholder="email@example.com" className="flex-1 py-2.5 text-sm outline-none placeholder:text-[#aeaeb2]" />
                <button onClick={() => { setShowBcc(false); setBcc(''); setBccSuggestions([]); }} className="p-1 rounded hover:bg-[#f5f5f7] text-muted transition-colors flex-shrink-0"><X size={12} /></button>
              </div>
              {bccSuggestions.length > 0 && <SuggestionDropdown suggestions={bccSuggestions} onPick={pickBccContact} />}
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center border-b border-[#f5f5f7] px-5">
            <span className="text-xs text-muted w-12 flex-shrink-0">Тема</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Тема письма" className="flex-1 py-2.5 text-sm outline-none placeholder:text-[#aeaeb2]" />
          </div>
        </div>

        {/* Body — rich text editor */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-[200px]">
          <EditorContent editor={editor} className="flex-1" />
          {signatureHtml && (
            <div className="px-5 py-3 border-t border-[#f5f5f7] flex-shrink-0">
              {settings?.signature_logo && (
                <img src={settings.signature_logo} alt="" className="h-8 max-w-[120px] object-contain mb-1.5" />
              )}
              {settings?.signature && (
                <p className="text-xs text-muted whitespace-pre-wrap leading-relaxed">{settings.signature}</p>
              )}
            </div>
          )}
        </div>

        {/* Formatting toolbar */}
        {editor && <FormatToolbar editor={editor} />}

        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="px-5 pb-2 flex flex-wrap gap-2 flex-shrink-0">
            {attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-[#f5f5f7] rounded-xl px-2.5 py-1.5">
                <Paperclip size={11} className="text-muted" />
                <span className="text-xs text-[#1d1d1f] max-w-[120px] truncate">{att.file.name}</span>
                <span className="text-[10px] text-muted">{formatBytes(att.file.size)}</span>
                <button onClick={() => removeAttachment(i)} className="text-muted hover:text-red-500 transition-colors"><X size={11} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="mx-5 mb-2 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 flex-shrink-0">{error}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#f5f5f7] flex-shrink-0">
          <div className="flex items-center gap-1">
            <button onClick={() => fileRef.current?.click()} className="p-2 rounded-xl hover:bg-[#f5f5f7] text-muted transition-colors" title="Прикрепить файл">
              <Paperclip size={16} />
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            <button onClick={saveDraft} className="p-2 rounded-xl hover:bg-[#f5f5f7] text-muted transition-colors" title="Сохранить черновик">
              <ChevronDown size={16} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleDiscard} className="p-2 rounded-xl hover:bg-[#f5f5f7] text-muted transition-colors" title="Удалить черновик">
              <Trash2 size={16} />
            </button>
            <button onClick={handleSend} className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
              <Send size={14} />
              Отправить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Formatting Toolbar ────────────────────────────────────────────────────────

const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#ffffff',
  '#ff0000', '#ff4500', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff',
  '#9900ff', '#ff00ff', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb',
  '#3c78d8', '#6aa84f', '#a64d79', '#cc4125', '#e69138',
];

function FormatToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [showColors, setShowColors] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) setShowColors(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  if (!editor) return null;

  function handleLink() {
    const prev = editor.getAttributes('link').href ?? '';
    const url = window.prompt('Ссылка:', prev);
    if (url === null) return;
    if (url === '') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().setLink({ href: url }).run();
  }

  const btnCls = (active: boolean) =>
    `p-1.5 rounded-lg transition-colors ${active ? 'bg-[#e8e8ed] text-[#1d1d1f]' : 'text-muted hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'}`;

  const currentColor = editor.getAttributes('textStyle').color ?? '#000000';

  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 border-t border-[#f5f5f7] flex-shrink-0 flex-wrap">
      {/* Undo / Redo */}
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().undo().run(); }} className={btnCls(false)} title="Отменить"><Undo2 size={14} /></button>
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().redo().run(); }} className={btnCls(false)} title="Повторить"><Redo2 size={14} /></button>

      <div className="w-px h-4 bg-[#e5e5ea] mx-1" />

      {/* Bold / Italic / Underline / Strike */}
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }} className={btnCls(editor.isActive('bold'))} title="Жирный (Ctrl+B)"><Bold size={14} /></button>
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }} className={btnCls(editor.isActive('italic'))} title="Курсив (Ctrl+I)"><Italic size={14} /></button>
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run(); }} className={btnCls(editor.isActive('underline'))} title="Подчёркивание (Ctrl+U)"><UnderlineIcon size={14} /></button>
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }} className={btnCls(editor.isActive('strike'))} title="Зачёркивание"><Strikethrough size={14} /></button>

      <div className="w-px h-4 bg-[#e5e5ea] mx-1" />

      {/* Text Color */}
      <div ref={colorRef} className="relative">
        <button
          onMouseDown={(e) => { e.preventDefault(); setShowColors((v) => !v); }}
          className={btnCls(false)}
          title="Цвет текста"
        >
          <span className="flex flex-col items-center leading-none">
            <span className="text-[11px] font-bold" style={{ color: currentColor }}>A</span>
            <span className="h-0.5 w-3.5 rounded-full mt-0.5" style={{ background: currentColor }} />
          </span>
        </button>
        {showColors && (
          <div className="absolute bottom-full left-0 mb-1 z-50 bg-white border border-[#e5e5ea] rounded-xl shadow-lg p-2">
            <div className="grid grid-cols-8 gap-1" style={{ width: 168 }}>
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    editor.chain().focus().setColor(color).run();
                    setShowColors(false);
                  }}
                  title={color}
                  className="w-4.5 h-4.5 rounded-sm border border-black/10 hover:scale-110 transition-transform"
                  style={{ width: 18, height: 18, background: color }}
                />
              ))}
            </div>
            <button
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setShowColors(false); }}
              className="mt-1.5 w-full text-[11px] text-muted hover:text-[#1d1d1f] text-center transition-colors"
            >
              Сбросить цвет
            </button>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-[#e5e5ea] mx-1" />

      {/* Lists */}
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }} className={btnCls(editor.isActive('bulletList'))} title="Маркированный список"><List size={14} /></button>
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }} className={btnCls(editor.isActive('orderedList'))} title="Нумерованный список"><ListOrdered size={14} /></button>

      <div className="w-px h-4 bg-[#e5e5ea] mx-1" />

      {/* Link */}
      <button onMouseDown={(e) => { e.preventDefault(); handleLink(); }} className={btnCls(editor.isActive('link'))} title="Вставить ссылку"><LinkIcon size={14} /></button>

      <div className="w-px h-4 bg-[#e5e5ea] mx-1" />

      {/* Clear formatting */}
      <button onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetAllMarks().clearNodes().run(); }} className={btnCls(false)} title="Убрать форматирование"><RemoveFormatting size={14} /></button>
    </div>
  );
}

// ─── Suggestion Dropdown ───────────────────────────────────────────────────────

interface SuggestionDropdownProps {
  suggestions: Contact[];
  onPick: (contact: Contact) => void;
}

function SuggestionDropdown({ suggestions, onPick }: SuggestionDropdownProps) {
  return (
    <div className="absolute left-0 right-0 top-full z-50 bg-white border border-[#e5e5ea] rounded-xl shadow-lg overflow-hidden">
      {suggestions.map((c) => (
        <button
          key={c.id}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
          className="w-full text-left px-4 py-2.5 hover:bg-[#f5f5f7] transition-colors flex items-baseline gap-2"
        >
          <span className="text-sm text-[#1d1d1f] font-medium truncate">{c.name || c.email}</span>
          {c.name && <span className="text-xs text-muted truncate">{c.email}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
