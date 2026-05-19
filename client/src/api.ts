export type UserPermissions = {
  canViewDashboard: boolean;
  canViewIntake: boolean;
  canViewVesselIntake: boolean;
  canViewCleared: boolean;
  canViewReports: boolean;
  canViewSettings: boolean;
  canMoveCargo: boolean;
  canChangeCargoStatus: boolean;
  canUploadPhotos: boolean;
  canAddFieldReports: boolean;
  canCreateUsers: boolean;
  canEditUsers: boolean;
  canResetPasswords: boolean;
  canConfigureRack: boolean;
  canManageSlots: boolean;
};

export const ROLE_PERMISSION_DEFAULTS: Record<string, UserPermissions> = {
  SUPER_ADMIN: {
    canViewDashboard: true, canViewIntake: true, canViewVesselIntake: true,
    canViewCleared: true, canViewReports: true, canViewSettings: true,
    canMoveCargo: true, canChangeCargoStatus: true, canUploadPhotos: true,
    canAddFieldReports: true, canCreateUsers: true, canEditUsers: true,
    canResetPasswords: true, canConfigureRack: true, canManageSlots: true,
  },
  ADMIN: {
    canViewDashboard: true, canViewIntake: true, canViewVesselIntake: true,
    canViewCleared: true, canViewReports: true, canViewSettings: true,
    canMoveCargo: true, canChangeCargoStatus: true, canUploadPhotos: true,
    canAddFieldReports: true, canCreateUsers: true, canEditUsers: true,
    canResetPasswords: true, canConfigureRack: false, canManageSlots: false,
  },
  CLERK: {
    canViewDashboard: true, canViewIntake: true, canViewVesselIntake: true,
    canViewCleared: true, canViewReports: true, canViewSettings: false,
    canMoveCargo: true, canChangeCargoStatus: true, canUploadPhotos: true,
    canAddFieldReports: true, canCreateUsers: false, canEditUsers: false,
    canResetPasswords: false, canConfigureRack: false, canManageSlots: false,
  },
};

export function resolveClientPermissions(user: { role: string; permissions: UserPermissions | null }): UserPermissions {
  if (user.role === 'SUPER_ADMIN') return { ...ROLE_PERMISSION_DEFAULTS['SUPER_ADMIN'] };
  const defaults = ROLE_PERMISSION_DEFAULTS[user.role] ?? ROLE_PERMISSION_DEFAULTS['CLERK'];
  if (!user.permissions) return { ...defaults };
  return { ...defaults, ...user.permissions };
}

export type CargoStatus =
  | 'IN_RACK'
  | 'CHECKED_FOR_AUCTION'
  | 'IN_CHECKING_AREA'
  | 'CLEARED'
  | 'MARKED_FOR_DISPOSAL'
  | 'DAMAGED';

export type Slot = {
  id: string;
  row: string;
  level: number;
  slot: number;
  isActive: boolean;
  cargos: {
    id: string;
    containerNo: string;
    blNo: string;
    consigneeName: string;
    isOverdue: boolean;
    status: CargoStatus;
  }[];
  portions: {
    id: string;
    label: string;
    quantity: number;
    pkgsType: string;
    status: CargoStatus;
    cargo: {
      id: string;
      containerNo: string;
      blNo: string;
      consigneeName: string;
      isOverdue: boolean;
      status: CargoStatus;
    };
  }[];
};

export type CargoPortion = {
  id: string;
  cargoId: string;
  label: string;
  quantity: number;
  pkgsType: string;
  currentSlotId: string | null;
  currentSlot?: { id: string } | null;
  status: CargoStatus;
  createdAt: string;
  updatedAt: string;
};

export type Cargo = {
  id: string;
  cssCcdNo: string;
  vesselName: string;
  dateOfArrival: string;
  containerNo: string;
  blNo: string;
  consigneeName: string;
  mark: string;
  commodity: string;
  cargoDescription: string;
  pkgsType: string;
  noOfPkgs: number;
  cbm: string | number;
  fclLcl: 'FCL' | 'LCL';
  containerSize: 'FT20' | 'FT40' | 'NA';
  detainedByCustoms: boolean;
  detainedByHealth: boolean;
  detainedCargoRefNo: string | null;
  reasonOfShifting: string;
  clearanceOfficer: string;
  clearanceEmployId: string;
  shiftedDate: string;
  remarks: string;
  currentSlotId: string | null;
  currentSlot?: { id: string } | null;
  portions?: CargoPortion[];
  isOverdue: boolean;
  status: CargoStatus;
  createdAt: string;
  updatedAt: string;
  photos?: { id: string; filePath: string; caption: string | null; uploadedBy: string; uploadedAt: string; kind: string }[];
  moveLogs?: {
    id: string;
    movedBy: string;
    movedAt: string;
    source: string;
    portion?: CargoPortion | null;
    fromSlot: { id: string } | null;
    toSlot: { id: string } | null;
    user?: { id: string; username: string; name: string } | null;
  }[];
  reports?: { id: string; note: string; reportedBy: string; reportedAt: string; photo: { filePath: string } | null }[];
};

export type RackConfig = {
  id: number;
  rows: string[];
  levels: number;
  slotsPerLevel: number;
};

export type AuthUser = {
  id: string;
  username: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
  permissions: UserPermissions;
};

export type AdminUser = {
  id: string;
  username: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
  isActive: boolean;
  telegramUsername: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  permissions: UserPermissions | null;
};

export type RackReport = {
  generatedAt: string;
  range: { start: string; end: string };
  summary: {
    totalSlots: number;
    activeSlots: number;
    disabledSlots: number;
    occupiedSlots: number;
    emptyActiveSlots: number;
    totalCargo: number;
    overdueCargo: number;
    unassignedCargo: number;
    intakes: number;
    intakeItems: number;
    intakeCbm: number;
    intakeCustomsHeld: number;
    intakeHealthHeld: number;
    moves: number;
    freedCargo: number;
    fieldReports: number;
    statusCounts: Record<CargoStatus, number>;
  };
  rowSummary: { row: string; total: number; active: number; occupied: number; overdue: number }[];
  intakes: (Pick<Cargo, 'id' | 'cssCcdNo' | 'containerNo' | 'blNo' | 'consigneeName' | 'vesselName' | 'noOfPkgs' | 'cbm' | 'detainedByCustoms' | 'detainedByHealth' | 'currentSlotId' | 'status' | 'createdAt'> & {
    portions?: Pick<CargoPortion, 'id' | 'label' | 'quantity' | 'pkgsType' | 'currentSlotId' | 'status'>[];
  })[];
  moves: {
    id: string;
    movedAt: string;
    cargo: Pick<Cargo, 'cssCcdNo' | 'containerNo' | 'blNo' | 'consigneeName'>;
    portion: Pick<CargoPortion, 'label' | 'quantity' | 'pkgsType'> | null;
    fromSlotId: string | null;
    toSlotId: string | null;
    movedBy: string;
    source: string;
  }[];
  freedCargo: Pick<Cargo, 'id' | 'cssCcdNo' | 'containerNo' | 'blNo' | 'consigneeName' | 'status' | 'updatedAt'>[];
  fieldReports: {
    id: string;
    reportedAt: string;
    reportedBy: string;
    note: string;
    cargo: Pick<Cargo, 'cssCcdNo' | 'containerNo' | 'blNo' | 'consigneeName'>;
  }[];
};

export type VesselManifestRow = {
  manifestRef: string;
  consigneeName: string;
  mark: string;
  commodity: string;
  cargoDescription: string;
  pkgsType: string;
  noOfPkgs: number;
  clearedQty: number;
  remarks: string;
};

export type VesselManifestPreview = {
  vesselName: string;
  arrivalDate: string;
  eligible: VesselManifestRow[];
  excluded: VesselManifestRow[];
};

export type DuplicateEntry = { blNo: string; cssCcdNo: string; consigneeName: string };

export class DuplicateImportError extends Error {
  constructor(public readonly duplicates: DuplicateEntry[]) {
    super('duplicate_manifest_entries');
    this.name = 'DuplicateImportError';
  }
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  const hasBody = init?.body != null;
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  if (hasBody && !isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      if (json?.error === 'duplicate_manifest_entries' && Array.isArray(json.duplicates)) {
        throw new DuplicateImportError(json.duplicates as DuplicateEntry[]);
      }
    } catch (e) {
      if (e instanceof DuplicateImportError) throw e;
    }
    throw new Error(`${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => http<{ ok: boolean; botEnabled: boolean; isLocal: boolean }>('/api/health'),
  me: () => http<{ user: AuthUser | null; mustChangePassword?: boolean }>('/api/auth/me'),
  login: (username: string, password: string) =>
    http<{ user: AuthUser; mustChangePassword: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => http<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    http<{ ok: true }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  listUsers: () => http<{ users: AdminUser[] }>('/api/auth/users'),
  createUser: (data: {
    username: string;
    name: string;
    password: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'CLERK';
    telegramUsername?: string | null;
    isActive: boolean;
    mustChangePassword: boolean;
  }) => http<AdminUser>('/api/auth/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: Partial<Pick<AdminUser, 'username' | 'name' | 'role' | 'telegramUsername' | 'isActive' | 'mustChangePassword'>>) =>
    http<AdminUser>(`/api/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  resetUserPassword: (id: string, password: string, mustChangePassword = true) =>
    http<{ ok: true }>(`/api/auth/users/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password, mustChangePassword }),
    }),
  updateUserPermissions: (id: string, permissions: UserPermissions | null) =>
    http<AdminUser>(`/api/auth/users/${id}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(permissions),
    }),
  slots: () => http<Slot[]>('/api/slots'),
  config: () => http<RackConfig | null>('/api/config'),
  putConfig: (cfg: Omit<RackConfig, 'id'>) =>
    http<{ config: RackConfig; newSlots: number; removedSlots: number; retainedSlots: string[] }>(
      '/api/config',
      { method: 'PUT', body: JSON.stringify(cfg) },
    ),
  deleteSlot: (id: string) =>
    http<{ ok: true } | { error: string; occupants?: number }>(`/api/slots/${id}`, { method: 'DELETE' }),
  deleteRow: (row: string) =>
    http<
      | { config: RackConfig; removedSlots: number }
      | { error: string; occupants?: { slotId: string | null; containerNo: string }[] }
    >(`/api/config/rows/${encodeURIComponent(row)}`, { method: 'DELETE' }),
  patchSlot: (id: string, isActive: boolean) =>
    http<Slot>(`/api/slots/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  listCargo: (opts?: {
    q?: string;
    status?: CargoStatus | CargoStatus[];
    unassigned?: boolean;
    vesselName?: string;
    arrivalDate?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    if (opts?.q) params.set('q', opts.q);
    if (opts?.status) {
      const v = Array.isArray(opts.status) ? opts.status.join(',') : opts.status;
      params.set('status', v);
    }
    if (opts?.unassigned) params.set('unassigned', 'true');
    if (opts?.vesselName) params.set('vesselName', opts.vesselName);
    if (opts?.arrivalDate) params.set('arrivalDate', opts.arrivalDate);
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
    const qs = params.toString();
    return http<{ items: Cargo[]; total: number; page: number; pageSize: number }>(
      `/api/cargo${qs ? `?${qs}` : ''}`,
    );
  },
  listVesselVoyages: () =>
    http<{ items: { vesselName: string; arrivalDate: string }[] }>('/api/cargo/vessels'),
  getCargo: (id: string) => http<Cargo>(`/api/cargo/${id}`),
  createCargo: (data: Partial<Cargo>) =>
    http<Cargo>('/api/cargo', { method: 'POST', body: JSON.stringify(data) }),
  previewVesselManifest: async (file: File) => {
    const fd = new FormData();
    fd.append('manifest', file);
    const res = await fetch('/api/cargo/vessel-manifest/preview', { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<VesselManifestPreview>;
  },
  listUnidentifiedVesselCargo: (vesselName: string, arrivalDate: string) => {
    const params = new URLSearchParams({ vesselName, arrivalDate });
    return http<{ items: Cargo[] }>(`/api/cargo/vessel-unidentified?${params.toString()}`);
  },
  createManualVesselCargo: (data: { vesselName: string; arrivalDate: string }) =>
    http<Cargo>('/api/cargo/vessel-manual', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createDetailedManualVesselCargo: (data: { vesselName: string; arrivalDate: string; row: VesselManifestRow }) =>
    http<Cargo>('/api/cargo/vessel-manual-detail', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createVesselCargo: (data: { vesselName: string; arrivalDate: string; rows: VesselManifestRow[] }) =>
    http<{ items: Cargo[]; total: number }>('/api/cargo/vessel-bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  lookupVesselCargo: (vesselName: string, arrivalDate: string, q: string) => {
    const params = new URLSearchParams({ vesselName, arrivalDate, q });
    return http<{
      items: { id: string; blNo: string; consigneeName: string; mark: string; cargoDescription: string; pkgsType: string; noOfPkgs: number; remarks: string }[];
    }>(`/api/cargo/vessel-lookup?${params.toString()}`);
  },
  mergeVesselRow: (cargoId: string, data: { vesselName: string; arrivalDate: string; row: VesselManifestRow }) =>
    http<Cargo>(`/api/cargo/${cargoId}/merge-vessel-row`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  splitCargo: (id: string, splitQty: number) =>
    http<{ original: Cargo; split: CargoPortion; source: CargoPortion }>(`/api/cargo/${id}/split`, {
      method: 'POST',
      body: JSON.stringify({ splitQty }),
    }),
  moveCargoPortion: (id: string, portionId: string, toSlotId: string | null, movedBy = 'office') =>
    http<{ ok: true }>(`/api/cargo/${id}/portions/${portionId}/move`, {
      method: 'POST',
      body: JSON.stringify({ toSlotId, movedBy }),
    }),
  deletePortion: (id: string, portionId: string) =>
    http<{ ok: true }>(`/api/cargo/${id}/portions/${portionId}`, { method: 'DELETE' }),
  updateCargo: (id: string, data: Partial<Cargo>) =>
    http<Cargo>(`/api/cargo/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCargoEntries: (ids: string[]) =>
    http<{ deleted: number }>('/api/cargo/bulk', { method: 'DELETE', body: JSON.stringify({ ids }) }),
  moveCargo: (id: string, toSlotId: string | null, movedBy = 'office') =>
    http<{ ok: true }>(`/api/cargo/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ toSlotId, movedBy }),
    }),
  setStatus: (id: string, status: CargoStatus, movedBy = 'office') =>
    http<{ ok: true }>(`/api/cargo/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, movedBy }),
    }),
  uploadPhoto: async (cargoId: string, file: File, caption?: string) => {
    const fd = new FormData();
    fd.append('photo', file);
    if (caption) fd.append('caption', caption);
    const res = await fetch(`/api/photos/cargo/${cargoId}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  rackReport: (start: string, end: string) => {
    const params = new URLSearchParams({ start, end });
    return http<RackReport>(`/api/reports/rack?${params.toString()}`);
  },
};
