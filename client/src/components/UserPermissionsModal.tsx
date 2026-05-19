import { useState } from 'react';
import { AdminUser, api, resolveClientPermissions, ROLE_PERMISSION_DEFAULTS, UserPermissions } from '../api.js';
import { useQueryClient } from '@tanstack/react-query';

type Section = {
  label: string;
  keys: (keyof UserPermissions)[];
};

const SECTIONS: Section[] = [
  {
    label: 'Pages',
    keys: ['canViewDashboard', 'canViewIntake', 'canViewVesselIntake', 'canViewCleared', 'canViewReports', 'canViewSettings'],
  },
  {
    label: 'Cargo Actions',
    keys: ['canMoveCargo', 'canChangeCargoStatus', 'canUploadPhotos', 'canAddFieldReports'],
  },
  {
    label: 'User Management',
    keys: ['canCreateUsers', 'canEditUsers', 'canResetPasswords'],
  },
  {
    label: 'Rack Configuration',
    keys: ['canConfigureRack', 'canManageSlots'],
  },
];

const PERMISSION_LABELS: Record<keyof UserPermissions, string> = {
  canViewDashboard: 'View Dashboard',
  canViewIntake: 'View CFS Intake',
  canViewVesselIntake: 'View Vessel Intake',
  canViewCleared: 'View Intakes (Cleared)',
  canViewReports: 'View Reports',
  canViewSettings: 'View Settings',
  canMoveCargo: 'Move Cargo',
  canChangeCargoStatus: 'Change Cargo Status',
  canUploadPhotos: 'Upload Photos',
  canAddFieldReports: 'Add Field Reports',
  canCreateUsers: 'Create Users',
  canEditUsers: 'Edit Users',
  canResetPasswords: 'Reset Passwords',
  canConfigureRack: 'Configure Rack',
  canManageSlots: 'Manage Slots',
};

type Props = {
  user: AdminUser;
  onClose: () => void;
};

export function UserPermissionsModal({ user, onClose }: Props) {
  const qc = useQueryClient();
  const roleDefaults = ROLE_PERMISSION_DEFAULTS[user.role] ?? ROLE_PERMISSION_DEFAULTS['CLERK'];
  const [draft, setDraft] = useState<UserPermissions>(() => resolveClientPermissions(user));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: keyof UserPermissions) {
    setDraft((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function resetToDefaults() {
    setDraft({ ...roleDefaults });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateUserPermissions(user.id, draft);
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto p-4">
      <div className="w-full max-w-2xl app-panel p-6 space-y-6 my-8">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{user.name}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              @{user.username} · {user.role.replace('_', ' ')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {SECTIONS.map((section) => (
          <div key={section.label} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {section.label}
            </h3>
            <div className="space-y-1">
              {section.keys.map((key) => {
                const isDefault = roleDefaults[key];
                return (
                  <label
                    key={key}
                    className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <span className="text-sm">
                      {PERMISSION_LABELS[key]}
                      <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                        default: {isDefault ? 'on' : 'off'}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      onChange={() => toggle(key)}
                      disabled={busy}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 dark:border-slate-600"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

        <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={resetToDefaults}
            disabled={busy}
            className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-50"
          >
            Reset to role defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="border rounded px-4 py-2 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="bg-slate-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {busy ? 'Saving...' : 'Save permissions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
