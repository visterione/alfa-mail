import { useEffect, useState } from 'react';
import { useStore } from './store';
import { api } from './api';
import LoginPage from './components/LoginPage';
import SetupPage from './components/SetupPage';
import MainLayout from './components/MainLayout';

export default function App() {
  const { user, setUser } = useStore();
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    async function init() {
      // Always check if first-time setup is needed
      try {
        await api.setup('', '', '');
        // If we get here (shouldn't happen), no-op
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } };
        if (err.response?.status === 400) {
          // 400 = endpoint exists but params missing = setup required
          setNeedsSetup(true);
          setLoading(false);
          return;
        }
        // 403 = setup already done, continue to auth check
      }

      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const u = await api.me();
        setUser(u);
      } catch {
        localStorage.removeItem('token');
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [setUser]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (needsSetup) return <SetupPage onDone={() => setNeedsSetup(false)} />;
  if (!user) return <LoginPage />;
  return <MainLayout />;
}
