import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export default function LoginPage() {
  const { setUser } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await api.login(username, password);
      localStorage.setItem('token', token);
      setUser(user);
    } catch {
      setError('Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-[#f5f5f7]">
      <div className="bg-white rounded-2xl shadow-panel p-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-accent rounded-2xl mb-4 shadow-lg shadow-accent/30">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M3 8l9 6 9-6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <rect x="3" y="6" width="18" height="13" rx="2" stroke="white" strokeWidth="2"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-[#1d1d1f] tracking-tight">AlfaMail</h1>
          <p className="text-sm text-muted mt-1">Корпоративная почта</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Логин</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7] rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-shadow placeholder:text-[#aeaeb2]"
              placeholder="Ваш логин"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#f5f5f7] rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-shadow placeholder:text-[#aeaeb2]"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
