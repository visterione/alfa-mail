import { useState } from 'react';
import { api } from '../api';

export default function SetupPage({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ username: '', password: '', display_name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.setup(form.username, form.password, form.display_name);
      onDone();
    } catch {
      setError('Ошибка при создании администратора');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-[#f5f5f7]">
      <div className="bg-white rounded-2xl shadow-panel p-10 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Первоначальная настройка</h1>
        <p className="text-sm text-muted mb-6">Создайте учётную запись администратора</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {(['display_name', 'username', 'password'] as const).map((field) => (
            <div key={field}>
              <label className="block text-sm font-medium mb-1.5">
                {field === 'display_name' ? 'Имя' : field === 'username' ? 'Логин' : 'Пароль'}
              </label>
              <input
                type={field === 'password' ? 'password' : 'text'}
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="w-full px-3.5 py-2.5 bg-[#f5f5f7] rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30"
                required
              />
            </div>
          ))}

          {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
          >
            {loading ? 'Создание...' : 'Создать'}
          </button>
        </form>
      </div>
    </div>
  );
}
