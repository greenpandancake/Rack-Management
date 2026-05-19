import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, Cargo, CargoStatus } from '../api.js';
import { SearchBar } from '../components/SearchBar.js';
import { useAuth } from '../auth.js';
import { cargoTypeLabel, companyName, shortDate, shortDateTime } from '../format.js';

const PAGE_SIZE = 50;

type Tab = {
  key: 'ALL_INTAKES' | 'UNASSIGNED' | 'CLEARED' | 'IN_CHECKING_AREA' | 'DISPOSAL' | 'ARCHIVED';
  label: string;
  statuses?: CargoStatus[];
  unassigned?: boolean;
};

const TABS: Tab[] = [
  { key: 'ALL_INTAKES', label: 'All Intakes' },
  { key: 'UNASSIGNED', label: 'Rack Slot Unassigned', unassigned: true },
  { key: 'CLEARED', label: 'Cleared', statuses: ['CLEARED'] },
  { key: 'IN_CHECKING_AREA', label: 'In Checking Area', statuses: ['IN_CHECKING_AREA'] },
  { key: 'DISPOSAL', label: 'Marked for Disposal', statuses: ['MARKED_FOR_DISPOSAL'] },
  { key: 'ARCHIVED', label: 'Archived / Damaged', statuses: ['CLEARED', 'IN_CHECKING_AREA', 'MARKED_FOR_DISPOSAL', 'DAMAGED'] },
];

export function Cleared() {
  const auth = useAuth();
  const qc = useQueryClient();
  const isSuperAdmin = auth.user?.role === 'SUPER_ADMIN';
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [q, setQ] = useState('');
  const [vesselKey, setVesselKey] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [tab.key, q, vesselKey]);

  const selectedVoyage = parseVesselKey(vesselKey);
  const vesselsQuery = useQuery({ queryKey: ['cargo', 'vessels'], queryFn: api.listVesselVoyages });

  const { data, isLoading } = useQuery({
    queryKey: ['cargo', 'archived', tab.key, q, vesselKey, page],
    queryFn: () =>
      api.listCargo({
        q: q || undefined,
        status: tab.statuses,
        unassigned: tab.unassigned,
        vesselName: selectedVoyage?.vesselName,
        arrivalDate: selectedVoyage?.arrivalDate,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleIds = rows.map((row) => row.id);
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length;

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const ok = window.confirm(`Delete ${ids.length} intake entr${ids.length === 1 ? 'y' : 'ies'}? This cannot be undone.`);
    if (!ok) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await api.deleteCargoEntries(ids);
      setSelectedIds(new Set());
      await qc.invalidateQueries({ queryKey: ['cargo'] });
      await qc.invalidateQueries({ queryKey: ['slots'] });
      if (result.deleted === 0) setDeleteError('No selected entries were found.');
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold">Intakes</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input min-w-56 text-sm"
            value={vesselKey}
            onChange={(e) => setVesselKey(e.target.value)}
            disabled={vesselsQuery.isLoading}
          >
            <option value="">All vessels</option>
            {(vesselsQuery.data?.items ?? []).map((voyage) => (
              <option key={vesselKeyFor(voyage)} value={vesselKeyFor(voyage)}>
                {voyage.vesselName} - {voyage.arrivalDate}
              </option>
            ))}
          </select>
          <SearchBar value={q} onChange={setQ} />
        </div>
      </div>

      {isSuperAdmin && (
        <div className="app-panel px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600 dark:text-slate-400">
            {selectedIds.size} selected
            {deleteError && <span className="ml-3 text-red-600 dark:text-red-400">{deleteError}</span>}
          </div>
          <button
            type="button"
            disabled={deleting || selectedIds.size === 0}
            onClick={deleteSelected}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            {deleting ? 'Deleting...' : 'Delete selected'}
          </button>
        </div>
      )}

      <div className="flex gap-1 border-b dark:border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${
              tab.key === t.key
                ? 'border-slate-900 text-slate-900 font-semibold dark:border-slate-100 dark:text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-500 app-panel p-6">
          No cargo in this category{q ? ` matching "${q}"` : ''}.
        </div>
      ) : (
        <div className="app-panel overflow-hidden">
          <table className="table-modern">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                {isSuperAdmin && (
                  <th className="text-left px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && selectedVisibleCount === rows.length}
                      onChange={(e) => toggleVisible(e.target.checked)}
                      aria-label="Select visible intakes"
                    />
                  </th>
                )}
                <th>Type</th>
                <th>BL</th>
                <th>Consignee</th>
                <th>Vessel</th>
                <th>Rack Slot</th>
                <th>Shifted</th>
                <th>Updated</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <CargoRow
                  key={c.id}
                  cargo={c}
                  selectable={isSuperAdmin}
                  selected={selectedIds.has(c.id)}
                  onToggle={() => toggleRow(c.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(total, page * PAGE_SIZE)} of {total}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="border rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-300"
            >
              Prev
            </button>
            <span className="px-2 py-1">Page {page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="border rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-300"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CargoRow({
  cargo,
  selectable,
  selected,
  onToggle,
}: {
  cargo: Cargo;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
      {selectable && (
        <td className="px-3 py-2">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${cargo.cssCcdNo}`} />
        </td>
      )}
      <td className="px-3 py-2">
        <Link to={`/cargo/${cargo.id}`} className="font-semibold text-slate-900 hover:underline dark:text-slate-100">
          {cargoTypeLabel(cargo.containerNo)}
        </Link>
      </td>
      <td className="font-mono text-xs text-slate-600 dark:text-slate-400">{cargo.blNo}</td>
      <td>{companyName(cargo.consigneeName)}</td>
      <td>{cargo.vesselName}</td>
      <td className="px-3 py-2">
        <RackSlotCell cargo={cargo} />
      </td>
      <td className="whitespace-nowrap">{shortDate(cargo.shiftedDate)}</td>
      <td className="whitespace-nowrap">{shortDateTime(cargo.updatedAt)}</td>
      <td className="px-3 py-2">
        <StatusBadge cargo={cargo} />
      </td>
    </tr>
  );
}

function RackSlotCell({ cargo }: { cargo: Cargo }) {
  const portions = cargo.portions ?? [];
  if (portions.length > 0) {
    const assigned = portions.filter((portion) => portion.currentSlotId);
    if (assigned.length === portions.length) {
      const unique = [...new Set(assigned.map((portion) => portion.currentSlotId))];
      return <span className="text-value">{unique.length === 1 ? unique[0] : `${unique.length} rack slots`}</span>;
    }
    return (
      <span className="badge badge-blue">
        {assigned.length === 0 ? 'Rack slot unassigned' : 'Partially assigned'}
      </span>
    );
  }
  if (cargo.currentSlotId) return <span className="text-value">{cargo.currentSlotId}</span>;
  return (
    <span className="badge badge-blue">
      Rack slot unassigned
    </span>
  );
}

function StatusBadge({ cargo }: { cargo: Cargo }) {
  const portions = cargo.portions ?? [];
  if (cargo.status === 'IN_RACK' && portions.length > 0) {
    const allAssigned = portions.every((portion) => portion.currentSlotId);
    return (
      <span className={`badge ${allAssigned ? 'badge-green' : 'badge-blue'}`}>
        {allAssigned ? 'IN_RACK' : 'PARTIALLY ASSIGNED'}
      </span>
    );
  }
  if (cargo.status === 'IN_RACK' && !cargo.currentSlotId) {
    return (
      <span className="badge badge-blue">
        RACK SLOT UNASSIGNED
      </span>
    );
  }
  const map: Record<CargoStatus, string> = {
    IN_RACK: 'badge-green',
    CHECKED_FOR_AUCTION: 'badge-amber',
    IN_CHECKING_AREA: 'badge-blue',
    CLEARED: 'badge-slate',
    MARKED_FOR_DISPOSAL: 'badge-red',
    DAMAGED: 'badge-red',
  };
  return (
    <span className={`badge ${map[cargo.status]}`}>
      {cargo.status.replace(/_/g, ' ')}
    </span>
  );
}

function vesselKeyFor(voyage: { vesselName: string; arrivalDate: string }) {
  return `${voyage.vesselName}||${voyage.arrivalDate}`;
}

function parseVesselKey(key: string) {
  if (!key) return null;
  const [vesselName, arrivalDate] = key.split('||');
  if (!vesselName || !arrivalDate) return null;
  return { vesselName, arrivalDate };
}
