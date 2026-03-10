import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  X, Plus, Trash2, UserPlus, Mail, ChevronDown, ChevronUp, Check,
  RefreshCw, Shield, ToggleLeft, ToggleRight, FileText, Save, ImagePlus,
} from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import type { EmailRule, AuditEntry } from '../types';

interface Props {
  onClose: () => void;
}

type Tab = 'mailboxes' | 'users' | 'rules' | 'audit';

export default function AdminPanel({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('mailboxes');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f5f5f7] flex-shrink-0">
          <h2 className="text-base font-semibold text-[#1d1d1f]">Настройки</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#f5f5f7] text-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 flex-shrink-0">
          {(
            [
              ['mailboxes', 'Почтовые ящики'],
              ['users', 'Пользователи'],
              ['rules', 'Правила'],
              ['audit', 'Аудит'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                tab === key ? 'bg-accent text-white' : 'text-muted hover:bg-[#f5f5f7]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {tab === 'mailboxes' && <MailboxesTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'rules' && <RulesTab />}
          {tab === 'audit' && <AuditTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Mailboxes Tab ────────────────────────────────────────────────────────────

function MailboxesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editSignatureId, setEditSignatureId] = useState<number | null>(null);
  const [form, setForm] = useState({
    email: '',
    display_name: '',
    password: '',
    imap_host: '',
    imap_port: '993',
    smtp_host: '',
    smtp_port: '587',
  });
  const [error, setError] = useState('');

  const { data: mailboxes = [] } = useQuery({
    queryKey: ['admin-mailboxes'],
    queryFn: () => api.getAdminMailboxes(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createMailbox({
        email: form.email,
        display_name: form.display_name || undefined,
        password: form.password,
        imap_host: form.imap_host,
        imap_port: parseInt(form.imap_port),
        imap_secure: parseInt(form.imap_port) === 993,
        smtp_host: form.smtp_host,
        smtp_port: parseInt(form.smtp_port),
        smtp_secure: parseInt(form.smtp_port) === 465,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-mailboxes'] });
      setShowForm(false);
      setForm({ email: '', display_name: '', password: '', imap_host: '', imap_port: '993', smtp_host: '', smtp_port: '587' });
      setError('');
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error ?? 'Ошибка');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteMailbox(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mailboxes'] }),
  });

  // Auto-fill IMAP/SMTP host from email domain
  function handleEmailBlur() {
    if (!form.email.includes('@')) return;
    const domain = form.email.split('@')[1];
    if (!form.imap_host) setForm((f) => ({ ...f, imap_host: `mail.${domain}`, smtp_host: `mail.${domain}` }));
  }

  return (
    <div className="space-y-3">
      {/* Existing mailboxes */}
      {(mailboxes as { id: number; email: string; display_name: string | null; imap_host: string; smtp_host: string }[]).map((mb) => (
        <div key={mb.id} className="border border-[#e5e5ea] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between p-3 bg-[#f5f5f7]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-sm font-semibold">
                {mb.email.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-[#1d1d1f]">{mb.display_name || mb.email}</p>
                <p className="text-xs text-muted">{mb.email} · {mb.imap_host}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setEditSignatureId(editSignatureId === mb.id ? null : mb.id)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors ${
                  editSignatureId === mb.id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-[#e5e5ea] hover:text-[#1d1d1f]'
                }`}
                title="Подпись"
              >
                <FileText size={13} />
                Подпись
              </button>
              <button
                onClick={() => deleteMutation.mutate(mb.id)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-muted hover:text-red-500 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {editSignatureId === mb.id && (
            <div className="border-t border-[#e5e5ea]">
              <MailboxSignatureEditor mailboxId={mb.id} />
            </div>
          )}
        </div>
      ))}

      {/* Add form */}
      {showForm ? (
        <div className="border border-[#e5e5ea] rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-[#1d1d1f] mb-1">Новый почтовый ящик</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-muted mb-1">Email адрес *</label>
              <input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                onBlur={handleEmailBlur}
                placeholder="user@company.ru"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Отображаемое имя</label>
              <input
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="Иван Иванов"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Пароль от ящика *</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">IMAP сервер *</label>
              <input
                value={form.imap_host}
                onChange={(e) => setForm((f) => ({ ...f, imap_host: e.target.value }))}
                placeholder="mail.hosting.reg.ru"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">IMAP порт</label>
              <input
                value={form.imap_port}
                onChange={(e) => setForm((f) => ({ ...f, imap_port: e.target.value }))}
                placeholder="993"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">SMTP сервер *</label>
              <input
                value={form.smtp_host}
                onChange={(e) => setForm((f) => ({ ...f, smtp_host: e.target.value }))}
                placeholder="mail.hosting.reg.ru"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">SMTP порт</label>
              <input
                value={form.smtp_port}
                onChange={(e) => setForm((f) => ({ ...f, smtp_port: e.target.value }))}
                placeholder="587"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>

          <div className="text-xs text-muted bg-blue-50 rounded-lg px-3 py-2">
            Для reg.ru: IMAP — <strong>mail.hosting.reg.ru:993</strong>, SMTP — <strong>mail.hosting.reg.ru:587</strong>
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setError(''); }} className="px-3 py-1.5 text-sm text-muted hover:bg-[#f5f5f7] rounded-lg transition-colors">
              Отмена
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="px-4 py-1.5 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-60"
            >
              {createMutation.isPending ? 'Добавление...' : 'Добавить'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center gap-2 px-4 py-3 border-2 border-dashed border-[#d1d1d6] hover:border-accent hover:text-accent text-muted rounded-xl text-sm transition-colors"
        >
          <Plus size={16} />
          Добавить почтовый ящик
        </button>
      )}
    </div>
  );
}

// ─── Mailbox Signature Editor ─────────────────────────────────────────────────

function MailboxSignatureEditor({ mailboxId }: { mailboxId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['mailbox-signature-admin', mailboxId],
    queryFn: () => api.getMailboxSignatureAdmin(mailboxId),
    staleTime: 5 * 60 * 1000,
  });

  const [signature, setSignature] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);

  const currentSig = signature ?? data?.signature ?? '';
  const currentLogo = logo ?? data?.signature_logo ?? '';

  const saveMutation = useMutation({
    mutationFn: () => api.saveMailboxSignature(mailboxId, { signature: currentSig, signature_logo: currentLogo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mailbox-signature-admin', mailboxId] });
      qc.invalidateQueries({ queryKey: ['mailbox-signature', mailboxId] });
    },
  });

  function handleLogoFile(file: File) {
    setLogoError('');
    if (file.size > 80 * 1024) {
      setLogoError('Файл слишком большой — максимум 80 КБ');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setLogo(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div className="p-4 space-y-3 bg-white">
      <p className="text-xs text-muted">Подпись добавляется ко всем исходящим письмам из этого ящика.</p>

      {/* Logo */}
      <div>
        <label className="block text-xs font-medium text-[#1d1d1f] mb-2">Логотип</label>
        {currentLogo ? (
          <div className="flex items-center gap-3">
            <img src={currentLogo} alt="" className="h-10 max-w-[140px] object-contain rounded-lg border border-[#e5e5ea]" />
            <button onClick={() => setLogo('')} className="text-xs text-red-500 hover:text-red-600 transition-colors">
              Удалить
            </button>
          </div>
        ) : (
          <button
            onClick={() => logoInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 border border-dashed border-[#d1d1d6] rounded-xl text-sm text-muted hover:border-accent hover:text-accent transition-colors"
          >
            <ImagePlus size={14} />
            Загрузить изображение
          </button>
        )}
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleLogoFile(e.target.files[0])}
        />
        {logoError && <p className="text-xs text-red-500 mt-1">{logoError}</p>}
        <p className="text-[11px] text-muted mt-1">PNG, JPG — до 80 КБ</p>
      </div>

      {/* Text */}
      <div>
        <label className="block text-xs font-medium text-[#1d1d1f] mb-2">Текст подписи</label>
        <textarea
          value={currentSig}
          onChange={(e) => setSignature(e.target.value)}
          placeholder={"С уважением,\nИван Иванов\nООО «Компания»"}
          rows={4}
          className="w-full px-3 py-2.5 bg-[#f5f5f7] rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/20 resize-none leading-relaxed"
        />
      </div>

      {saveMutation.isSuccess && (
        <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2">Подпись сохранена</p>
      )}
      <div className="flex justify-end">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
        >
          <Save size={14} />
          {saveMutation.isPending ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', display_name: '', is_admin: false });
  const [error, setError] = useState('');
  const [expandedUser, setExpandedUser] = useState<number | null>(null);

  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.getUsers(),
  });

  const { data: allMailboxes = [] } = useQuery({
    queryKey: ['admin-mailboxes'],
    queryFn: () => api.getAdminMailboxes(),
  });

  const createMutation = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setShowForm(false);
      setForm({ username: '', password: '', display_name: '', is_admin: false });
      setError('');
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error ?? 'Ошибка');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  return (
    <div className="space-y-3">
      {(users as { id: number; username: string; display_name: string; is_admin: number }[]).map((u) => (
        <UserRow
          key={u.id}
          user={u}
          allMailboxes={allMailboxes as { id: number; email: string; display_name: string | null }[]}
          expanded={expandedUser === u.id}
          onToggle={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
          onDelete={() => deleteMutation.mutate(u.id)}
        />
      ))}

      {showForm ? (
        <div className="border border-[#e5e5ea] rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-[#1d1d1f]">Новый пользователь</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted mb-1">Имя</label>
              <input
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                placeholder="Иван Иванов"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Логин *</label>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="ivanov"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Пароль *</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_admin}
                  onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))}
                  className="w-4 h-4 accent-[#007AFF]"
                />
                <span className="text-sm text-[#1d1d1f]">Администратор</span>
              </label>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowForm(false); setError(''); }} className="px-3 py-1.5 text-sm text-muted hover:bg-[#f5f5f7] rounded-lg transition-colors">
              Отмена
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="px-4 py-1.5 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-60"
            >
              {createMutation.isPending ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center gap-2 px-4 py-3 border-2 border-dashed border-[#d1d1d6] hover:border-accent hover:text-accent text-muted rounded-xl text-sm transition-colors"
        >
          <UserPlus size={16} />
          Добавить пользователя
        </button>
      )}
    </div>
  );
}

function UserRow({
  user, allMailboxes, expanded, onToggle, onDelete,
}: {
  user: { id: number; username: string; display_name: string; is_admin: number };
  allMailboxes: { id: number; email: string; display_name: string | null }[];
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();

  const { data: assigned = [] } = useQuery({
    queryKey: ['admin-user-mailboxes', user.id],
    queryFn: () => api.getUserMailboxes(user.id),
    enabled: expanded,
  });

  const assignMutation = useMutation({
    mutationFn: (mailboxId: number) => api.assignMailbox(user.id, mailboxId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-user-mailboxes', user.id] }),
  });

  const unassignMutation = useMutation({
    mutationFn: (mailboxId: number) => api.unassignMailbox(user.id, mailboxId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-user-mailboxes', user.id] }),
  });

  const assignedIds = new Set((assigned as { id: number }[]).map((m) => m.id));

  return (
    <div className="border border-[#e5e5ea] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-3 bg-[#fafafa]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#e5e5ea] flex items-center justify-center text-[#3a3a3c] text-sm font-semibold">
            {user.display_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-[#1d1d1f]">
              {user.display_name}
              {user.is_admin ? <span className="ml-2 text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded-full">admin</span> : null}
            </p>
            <p className="text-xs text-muted">{user.username}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-xs text-muted hover:text-accent px-2 py-1 rounded-lg hover:bg-[#f5f5f7] transition-colors"
            title="Назначить ящики"
          >
            <Mail size={13} />
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-muted hover:text-red-500 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-[#f5f5f7]">
          <p className="text-xs text-muted mb-2 mt-2">Доступные ящики</p>
          <div className="space-y-1">
            {allMailboxes.length === 0 && (
              <p className="text-xs text-muted">Нет добавленных ящиков. Сначала добавьте на вкладке «Почтовые ящики».</p>
            )}
            {allMailboxes.map((mb) => {
              const isAssigned = assignedIds.has(mb.id);
              return (
                <button
                  key={mb.id}
                  onClick={() => isAssigned ? unassignMutation.mutate(mb.id) : assignMutation.mutate(mb.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                    isAssigned ? 'bg-accent/10 text-accent' : 'hover:bg-[#f5f5f7] text-[#3a3a3c]'
                  }`}
                >
                  <span>{mb.display_name || mb.email}</span>
                  {isAssigned && <Check size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Rules Tab ────────────────────────────────────────────────────────────────

const CONDITION_FIELD_LABELS: Record<string, string> = {
  from: 'от кого',
  to: 'кому',
  subject: 'тема',
  any: 'любое поле',
};

const CONDITION_OP_LABELS: Record<string, string> = {
  contains: 'содержит',
  equals: 'равно',
};

const ACTION_LABELS: Record<string, string> = {
  move: 'Переместить в папку',
  flag: 'Отметить важным',
  mark_read: 'Пометить прочитанным',
  delete: 'Удалить',
};

function RulesTab() {
  const qc = useQueryClient();
  const { activeMailbox } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    condition_field: 'from',
    condition_op: 'contains',
    condition_value: '',
    action: 'move',
    action_param: '',
  });
  const [error, setError] = useState('');

  const mailboxId = activeMailbox?.id ?? null;

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['rules', mailboxId],
    queryFn: () => api.getRules(mailboxId!),
    enabled: mailboxId !== null,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createRule({
        mailbox_id: mailboxId!,
        name: form.name,
        condition_field: form.condition_field,
        condition_op: form.condition_op,
        condition_value: form.condition_value,
        action: form.action,
        action_param: form.action === 'move' ? form.action_param : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules', mailboxId] });
      setShowForm(false);
      setForm({ name: '', condition_field: 'from', condition_op: 'contains', condition_value: '', action: 'move', action_param: '' });
      setError('');
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error ?? 'Ошибка');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.toggleRule(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules', mailboxId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules', mailboxId] }),
  });

  if (mailboxId === null) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
        <Shield size={32} className="opacity-30" />
        <p className="text-sm">Выберите ящик для управления правилами</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isLoading && (
        <p className="text-sm text-muted text-center py-4">Загрузка...</p>
      )}

      {!isLoading && (rules as EmailRule[]).length === 0 && !showForm && (
        <p className="text-sm text-muted text-center py-4">Нет правил для этого ящика</p>
      )}

      {(rules as EmailRule[]).map((rule) => (
        <div key={rule.id} className="flex items-center justify-between p-3 bg-[#f5f5f7] rounded-xl gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#1d1d1f] truncate">{rule.name}</p>
            <p className="text-xs text-muted mt-0.5">
              {CONDITION_FIELD_LABELS[rule.condition_field] ?? rule.condition_field}{' '}
              {CONDITION_OP_LABELS[rule.condition_op] ?? rule.condition_op}{' '}
              <span className="font-medium text-[#3a3a3c]">"{rule.condition_value}"</span>
              {' · '}
              {ACTION_LABELS[rule.action] ?? rule.action}
              {rule.action === 'move' && rule.action_param ? ` → ${rule.action_param}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => toggleMutation.mutate({ id: rule.id, active: !rule.active })}
              className={`p-1.5 rounded-lg transition-colors ${
                rule.active ? 'text-accent hover:bg-accent/10' : 'text-muted hover:bg-[#e5e5ea]'
              }`}
              title={rule.active ? 'Отключить' : 'Включить'}
            >
              {rule.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            </button>
            <button
              onClick={() => deleteMutation.mutate(rule.id)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-muted hover:text-red-500 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}

      {showForm ? (
        <div className="border border-[#e5e5ea] rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-[#1d1d1f]">Новое правило</p>

          <div>
            <label className="block text-xs text-muted mb-1">Название *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Например: Спам в папку"
              className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-muted mb-1">Поле</label>
              <select
                value={form.condition_field}
                onChange={(e) => setForm((f) => ({ ...f, condition_field: e.target.value }))}
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="from">От кого</option>
                <option value="to">Кому</option>
                <option value="subject">Тема</option>
                <option value="any">Любое поле</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Условие</label>
              <select
                value={form.condition_op}
                onChange={(e) => setForm((f) => ({ ...f, condition_op: e.target.value }))}
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="contains">содержит</option>
                <option value="equals">равно</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">Значение *</label>
              <input
                value={form.condition_value}
                onChange={(e) => setForm((f) => ({ ...f, condition_value: e.target.value }))}
                placeholder="spam"
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted mb-1">Действие</label>
              <select
                value={form.action}
                onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}
                className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="move">Переместить в папку</option>
                <option value="flag">Отметить важным</option>
                <option value="mark_read">Пометить прочитанным</option>
                <option value="delete">Удалить</option>
              </select>
            </div>
            {form.action === 'move' && (
              <div>
                <label className="block text-xs text-muted mb-1">Папка назначения *</label>
                <input
                  value={form.action_param}
                  onChange={(e) => setForm((f) => ({ ...f, action_param: e.target.value }))}
                  placeholder="Spam"
                  className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowForm(false); setError(''); }}
              className="px-3 py-1.5 text-sm text-muted hover:bg-[#f5f5f7] rounded-lg transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="px-4 py-1.5 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-60"
            >
              {createMutation.isPending ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center gap-2 px-4 py-3 border-2 border-dashed border-[#d1d1d6] hover:border-accent hover:text-accent text-muted rounded-xl text-sm transition-colors"
        >
          <Plus size={16} />
          Добавить правило
        </button>
      )}
    </div>
  );
}

// ─── Audit Tab ────────────────────────────────────────────────────────────────

const ACTION_RU: Record<string, string> = {
  login: 'Вход',
  login_failed: 'Неудачная попытка',
  send: 'Отправка письма',
  delete: 'Удаление',
  move: 'Перемещение',
  password_changed: 'Смена пароля',
};

function AuditTab() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => api.getAuditLog({ limit: 100 }),
  });

  const entries: AuditEntry[] = data?.entries ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {isLoading ? 'Загрузка...' : `Записей: ${data?.total ?? 0}`}
        </p>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted hover:text-accent hover:bg-[#f5f5f7] rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          Обновить
        </button>
      </div>

      {!isLoading && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted">
          <Shield size={32} className="opacity-30" />
          <p className="text-sm">Нет записей</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="border border-[#e5e5ea] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f5f5f7] border-b border-[#e5e5ea]">
                <th className="text-left px-3 py-2 text-xs font-medium text-muted">Дата и время</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted">Пользователь</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted">Действие</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted hidden sm:table-cell">Детали</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted hidden md:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr
                  key={entry.id}
                  className={`border-b border-[#f5f5f7] last:border-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}`}
                >
                  <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">
                    {entry.created_at
                      ? format(new Date(entry.created_at * 1000), 'dd MMM yyyy, HH:mm', { locale: ru })
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-[#1d1d1f] font-medium">
                    {entry.username ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${
                      entry.action === 'login_failed'
                        ? 'bg-red-50 text-red-600'
                        : entry.action === 'login'
                        ? 'bg-green-50 text-green-700'
                        : entry.action === 'delete'
                        ? 'bg-orange-50 text-orange-600'
                        : 'bg-accent/10 text-accent'
                    }`}>
                      {ACTION_RU[entry.action] ?? entry.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted hidden sm:table-cell max-w-[160px] truncate">
                    {entry.details ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted hidden md:table-cell font-mono">
                    {entry.ip ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
