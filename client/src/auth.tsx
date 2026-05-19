import { createContext, FormEvent, ReactNode, useContext, useEffect, useState } from 'react';
import { api, AuthUser } from './api.js';

type AuthState = {
  user: AuthUser | null;
  mustChangePassword: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const me = await api.me();
    setUser(me.user);
    setMustChangePassword(Boolean(me.mustChangePassword));
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const res = await api.login(username, password);
    setUser(res.user);
    setMustChangePassword(res.mustChangePassword);
  }

  async function logout() {
    await api.logout();
    setUser(null);
    setMustChangePassword(false);
  }

  return (
    <AuthContext.Provider value={{ user, mustChangePassword, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(username, password);
    } catch {
      setError('Invalid username or password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full grid place-items-center bg-slate-100 px-4">
      <form onSubmit={submit} className="w-full max-w-sm app-panel p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold">MPL Smart Rack</h1>
          <p className="text-sm text-slate-600 mt-1">Sign in to continue.</p>
        </div>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Username</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button disabled={busy} className="btn-primary w-full">
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

export function ChangePasswordPage() {
  const auth = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      await auth.refresh();
    } catch {
      setError('Could not change password. Check the current password and use at least 6 characters.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full grid place-items-center bg-slate-100 px-4">
      <form onSubmit={submit} className="w-full max-w-sm app-panel p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold">Change password</h1>
          <p className="text-sm text-slate-600 mt-1">Set a new password before using the system.</p>
        </div>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Current password</span>
          <input className="input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">New password</span>
          <input className="input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button disabled={busy} className="btn-primary w-full">
          {busy ? 'Saving...' : 'Save password'}
        </button>
      </form>
    </main>
  );
}
