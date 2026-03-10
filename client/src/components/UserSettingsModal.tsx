import { useState } from 'react';
import { X, Key } from 'lucide-react';
import { api } from '../api';

interface Props {
  onClose: () => void;
}

export default function UserSettingsModal({ onClose }: Props) {
  const [current, setCurrent] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setError('');
    setSuccess(false);
    if (!current || !newPass) { setError('Заполните все поля'); return; }
    if (newPass.length < 6) { setError('Новый пароль минимум 6 символов'); return; }
    if (newPass !== confirm) { setError('Пароли не совпадают'); return; }
    try {
      await api.changePassword(current, newPass);
      setSuccess(true);
      setCurrent(''); setNewPass(''); setConfirm('');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err.response?.data?.error ?? 'Ошибка');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-panel w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f5f5f7]">
          <h2 className="text-base font-semibold text-[#1d1d1f]">Смена пароля</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#f5f5f7] text-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">Текущий пароль</label>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Новый пароль</label>
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="Минимум 6 символов"
              className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Подтверждение</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Повторите новый пароль"
              className="w-full px-3 py-2 bg-[#f5f5f7] rounded-lg text-sm outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          {success && <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2">Пароль успешно изменён</p>}
          <div className="flex justify-end pt-1">
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              <Key size={14} />
              Изменить пароль
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
