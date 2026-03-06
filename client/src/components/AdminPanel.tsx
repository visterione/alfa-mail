import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, UserPlus, Mail, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { api } from '../api';

interface Props {
  onClose: () => void;
}

type Tab = 'mailboxes' | 'users';

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
          {([['mailboxes', 'Почтовые ящики'], ['users', 'Пользователи']] as [Tab, string][]).map(([key, label]) => (
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
          {tab === 'mailboxes' ? <MailboxesTab /> : <UsersTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Mailboxes Tab ────────────────────────────────────────────────────────────

function MailboxesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
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
        <div key={mb.id} className="flex items-center justify-between p-3 bg-[#f5f5f7] rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-sm font-semibold">
              {mb.email.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-[#1d1d1f]">{mb.display_name || mb.email}</p>
              <p className="text-xs text-muted">{mb.email} · {mb.imap_host}</p>
            </div>
          </div>
          <button
            onClick={() => deleteMutation.mutate(mb.id)}
            className="p-1.5 rounded-lg hover:bg-red-50 text-muted hover:text-red-500 transition-colors"
          >
            <Trash2 size={14} />
          </button>
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
