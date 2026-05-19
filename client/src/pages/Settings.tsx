import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminUser, api, Slot } from '../api.js';
import { useAuth } from '../auth.js';
import { activeSlotOccupants } from '../components/SlotCell.js';

export function Settings() {
  const auth = useAuth();
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: api.config });
  const { data: slots } = useQuery({ queryKey: ['slots'], queryFn: api.slots });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: api.listUsers });
  const [rowsCsv, setRowsCsv] = useState('');
  const [levels, setLevels] = useState(3);
  const [slotsPerLevel, setSlotsPerLevel] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [userMsg, setUserMsg] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({
    username: '',
    name: '',
    password: '',
    role: 'CLERK' as AdminUser['role'],
    telegramUsername: '',
  });
  const isSuperAdmin = auth.user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (cfg) {
      setRowsCsv(cfg.rows.join(','));
      setLevels(cfg.levels);
      setSlotsPerLevel(cfg.slotsPerLevel);
    }
  }, [cfg]);

  const grouped = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      if (!m.has(s.row)) m.set(s.row, []);
      m.get(s.row)!.push(s);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const rows = rowsCsv.split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
      const out = await api.putConfig({ rows, levels, slotsPerLevel });
      const parts = [`${out.newSlots} new`, `${out.removedSlots} removed`];
      if (out.retainedSlots.length > 0) {
        parts.push(`${out.retainedSlots.length} kept (in use): ${out.retainedSlots.join(', ')}`);
      }
      setMsg(`Saved. ${parts.join(' · ')}`);
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteSlot(id: string) {
    if (!confirm(`Delete slot ${id}?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.deleteSlot(id);
      if ('error' in res) {
        setMsg(
          res.error === 'slot_in_use'
            ? `${id} is in use by ${res.occupants ?? '?'} cargo — clear or move it first.`
            : `Failed: ${res.error}`,
        );
      } else {
        setMsg(`Deleted ${id}.`);
        qc.invalidateQueries({ queryKey: ['slots'] });
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRow(row: string) {
    if (!confirm(`Delete entire row ${row}? All slots in this row will be removed.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.deleteRow(row);
      if ('error' in res) {
        const occ = res.occupants ?? [];
        setMsg(
          `Cannot delete row ${row} — ${occ.length} slot(s) in use: ${occ
            .map((o) => `${o.slotId} (${o.containerNo})`)
            .join(', ')}. Clear them and try again.`,
        );
      } else {
        setMsg(`Row ${row} deleted (${res.removedSlots} slot(s) removed).`);
        qc.invalidateQueries({ queryKey: ['config'] });
        qc.invalidateQueries({ queryKey: ['slots'] });
      }
    } catch (e) {
      const m = (e as Error).message;
      const match = m.match(/^409 (.+)$/);
      if (match) {
        try {
          const body = JSON.parse(match[1]) as { occupants?: { slotId: string; containerNo: string }[] };
          const occ = body.occupants ?? [];
          setMsg(
            `Cannot delete row ${row} — ${occ.length} slot(s) in use: ${occ
              .map((o) => `${o.slotId} (${o.containerNo})`)
              .join(', ')}. Clear them and try again.`,
          );
          return;
        } catch {
          /* fall through */
        }
      }
      setMsg(m);
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(slot: Slot) {
    setBusy(true);
    setMsg(null);
    try {
      await api.patchSlot(slot.id, !slot.isActive);
      qc.invalidateQueries({ queryKey: ['slots'] });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setUserMsg(null);
    try {
      await api.createUser({
        ...newUser,
        telegramUsername: newUser.telegramUsername || null,
        isActive: true,
        mustChangePassword: true,
      });
      setNewUser({ username: '', name: '', password: '', role: 'CLERK', telegramUsername: '' });
      setUserMsg('User created.');
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      setUserMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(user: AdminUser, data: Partial<AdminUser>) {
    setBusy(true);
    setUserMsg(null);
    try {
      await api.updateUser(user.id, data);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      setUserMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(user: AdminUser) {
    const password = window.prompt(`New password for ${user.username} (minimum 6 characters)`);
    if (!password) return;
    setBusy(true);
    setUserMsg(null);
    try {
      await api.resetUserPassword(user.id, password, true);
      setUserMsg(`Password reset for ${user.username}.`);
    } catch (e) {
      setUserMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-xl font-bold">Rack Settings</h2>

      <div className="app-panel p-6 space-y-4">
        <h3 className="font-bold">Users</h3>
        <form onSubmit={handleCreateUser} className="grid md:grid-cols-6 gap-2 items-end">
          <label className="block md:col-span-1">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Username</span>
            <input className="border rounded px-2 py-1 w-full text-sm" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
          </label>
          <label className="block md:col-span-1">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Name</span>
            <input className="border rounded px-2 py-1 w-full text-sm" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} />
          </label>
          <label className="block md:col-span-1">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Password</span>
            <input className="border rounded px-2 py-1 w-full text-sm" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          </label>
          <label className="block md:col-span-1">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Telegram</span>
            <input className="border rounded px-2 py-1 w-full text-sm" placeholder="@username" value={newUser.telegramUsername} onChange={(e) => setNewUser({ ...newUser, telegramUsername: e.target.value })} />
          </label>
          <label className="block md:col-span-1">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Role</span>
            <select className="border rounded px-2 py-1 w-full text-sm" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as AdminUser['role'] })}>
              <option value="CLERK">Staff</option>
              <option value="ADMIN">Admin</option>
              {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
            </select>
          </label>
          <button disabled={busy} className="bg-slate-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">Add user</button>
        </form>
        {userMsg && <div className="text-sm text-slate-700 dark:text-slate-300">{userMsg}</div>}
        <div className="overflow-x-auto">
          <table className="table-modern min-w-full">
            <thead className="text-xs text-slate-500 text-left">
              <tr>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Telegram</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Last login</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(users?.users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{u.username}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{u.name}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <select disabled={busy || (!isSuperAdmin && u.role === 'SUPER_ADMIN')} className="border rounded px-2 py-1 text-xs" value={u.role} onChange={(e) => patchUser(u, { role: e.target.value as AdminUser['role'] })}>
                      <option value="CLERK">Staff</option>
                      <option value="ADMIN">Admin</option>
                      {(isSuperAdmin || u.role === 'SUPER_ADMIN') && <option value="SUPER_ADMIN">Super Admin</option>}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      disabled={busy}
                      className="border rounded px-2 py-1 text-xs w-36"
                      defaultValue={u.telegramUsername ?? ''}
                      onBlur={(e) => patchUser(u, { telegramUsername: e.target.value || null })}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <button disabled={busy} onClick={() => patchUser(u, { isActive: !u.isActive })} className={`rounded px-2 py-1 text-xs ${u.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                      {u.isActive ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500 dark:text-slate-400">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '-'}</td>
                  <td className="py-2 pr-3 text-right">
                    <button disabled={busy} onClick={() => resetPassword(u)} className="border rounded px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-300">Reset password</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isSuperAdmin ? (
      <form onSubmit={handleSubmit} className="app-panel p-6 space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Editing rows/levels/slots resizes the rack. New slots are created. Out-of-range slots that are
          <span className="font-semibold"> empty</span> get deleted; ones still holding cargo are kept but
          marked disabled — clear them and save again to remove.
        </p>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Rows (comma separated, e.g. A,B,C,D,E)</span>
          <input className="border rounded px-2 py-1 w-full text-sm" value={rowsCsv} onChange={(e) => setRowsCsv(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Levels</span>
            <input type="number" min={1} max={20} className="border rounded px-2 py-1 w-full text-sm" value={levels} onChange={(e) => setLevels(Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Slots per Level</span>
            <input type="number" min={1} max={50} className="border rounded px-2 py-1 w-full text-sm" value={slotsPerLevel} onChange={(e) => setSlotsPerLevel(Number(e.target.value))} />
          </label>
        </div>
        <button disabled={busy} className="bg-slate-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">
          {busy ? 'Saving…' : 'Save Settings'}
        </button>
        {msg && <div className="text-sm text-slate-700 dark:text-slate-300">{msg}</div>}
      </form>
      ) : (
        <div className="app-panel p-6 text-sm text-slate-600 dark:text-slate-400">
          Rack sizing and slot maintenance are super admin settings.
        </div>
      )}

      {isSuperAdmin && <div className="app-panel p-6 space-y-4">
        <h3 className="font-bold">Existing slots</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Disable a broken slot so nothing can be placed there, or delete it permanently if it has never
          been used. Slots holding cargo cannot be deleted.
        </p>
        {grouped.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-400">No slots yet.</div>}
        {grouped.map(([row, rowSlots]) => {
          const rowInUse = rowSlots.some((s) => activeSlotOccupants(s).length > 0);
          return (
          <div key={row} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Row {row}</div>
              <button
                disabled={busy || rowInUse}
                onClick={() => handleDeleteRow(row)}
                title={rowInUse ? 'Clear all cargo in this row first' : `Delete row ${row}`}
                className="text-[11px] border border-red-300 text-red-600 rounded px-2 py-0.5 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Delete row {row}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {rowSlots.map((s) => {
                const occupants = activeSlotOccupants(s);
                const inUse = occupants.length > 0;
                return (
                  <div
                    key={s.id}
                    className={`border rounded p-2 text-xs space-y-1 ${
                      s.isActive ? 'bg-white dark:bg-slate-700' : 'bg-slate-100 border-dashed dark:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{s.id}</span>
                      <span className={inUse ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>
                        {inUse ? occupants[0].label ?? occupants[0].containerNo : 'empty'}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        disabled={busy}
                        onClick={() => handleToggleActive(s)}
                        className="flex-1 border rounded px-1.5 py-0.5 text-[11px] hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-300"
                      >
                        {s.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        disabled={busy || inUse}
                        onClick={() => handleDeleteSlot(s.id)}
                        title={inUse ? 'In use — move cargo out first' : 'Delete this slot'}
                        className="flex-1 border border-red-300 text-red-600 rounded px-1.5 py-0.5 text-[11px] hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
        })}
      </div>}
    </div>
  );
}
