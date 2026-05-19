import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { RackGrid } from '../components/RackGrid.js';
import { activeSlotOccupants } from '../components/SlotCell.js';
import { SearchBar } from '../components/SearchBar.js';
import { cargoTypeLabel, companyName, shortDate } from '../format.js';

const PAGE_SIZE = 50;

export function Dashboard() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const slotsQuery = useQuery({ queryKey: ['slots'], queryFn: api.slots });
  const cargoQuery = useQuery({
    queryKey: ['cargo', 'list', q, page],
    queryFn: () => api.listCargo({ q, page, pageSize: PAGE_SIZE }),
    enabled: q.trim().length > 0,
  });

  const stats = useMemo(() => {
    const slots = slotsQuery.data ?? [];
    let occupied = 0;
    let overdue = 0;
    for (const s of slots) {
      const occupants = activeSlotOccupants(s);
      if (occupants.length > 0) {
        occupied++;
        if (occupants.some((occ) => occ.isOverdue)) overdue++;
      }
    }
    return { total: slots.length, occupied, overdue };
  }, [slotsQuery.data]);

  return (
    <div className="space-y-6">
      <div className="app-panel p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex gap-3">
          <Stat label="Total Slots" value={stats.total} />
          <Stat label="Occupied" value={stats.occupied} />
          <Stat label="Overdue (30d+)" value={stats.overdue} tone={stats.overdue > 0 ? 'red' : undefined} />
        </div>
        <SearchBar value={q} onChange={(v) => { setQ(v); setPage(1); }} />
      </div>

      <div className="app-muted-panel px-4 py-2 flex items-center gap-3 text-xs text-slate-600">
        <Legend color="bg-white border" label="empty" />
        <Legend color="bg-emerald-500" label="occupied" />
        <Legend color="bg-red-500" label="overdue" />
        <Legend color="bg-slate-50 border border-dashed" label="disabled" />
      </div>

      {q.trim().length > 0 ? (
        <SearchResults
          results={cargoQuery.data?.items ?? []}
          total={cargoQuery.data?.total ?? 0}
          page={page}
          pageSize={PAGE_SIZE}
          onPage={setPage}
        />
      ) : (
        <>
          {slotsQuery.isLoading ? <div className="app-panel p-6 text-sm text-slate-500">Loading...</div> : <RackGrid slots={slotsQuery.data ?? []} />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className={`metric-card ${tone === 'red' ? 'bg-red-50 border-red-200 text-red-700' : ''}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block w-3 h-3 rounded ${color}`} />
      {label}
    </span>
  );
}

function SearchResults({
  results,
  total,
  page,
  pageSize,
  onPage,
}: {
  results: Awaited<ReturnType<typeof api.listCargo>>['items'];
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return <div className="text-slate-500 text-sm">No matches.</div>;
  return (
    <div className="space-y-2">
      <div className="app-panel divide-y">
        {results.map((c) => (
          <Link to={`/cargo/${c.id}`} key={c.id} className="block p-3 hover:bg-slate-50 text-sm">
            <div className="flex justify-between">
              <div className="font-semibold">{cargoTypeLabel(c.containerNo)} <span className="text-slate-400">-</span> {companyName(c.consigneeName)}</div>
              <div className="text-slate-500">{rackLocationLabel(c)} {c.isOverdue && <span className="ml-2 text-red-600">OVERDUE</span>}</div>
            </div>
            <div className="text-xs text-slate-500">BL {c.blNo} - {c.vesselName} - shifted {shortDate(c.shiftedDate)}</div>
          </Link>
        ))}
      </div>
      <Pager total={total} page={page} pageSize={pageSize} onPage={onPage} />
    </div>
  );
}

function rackLocationLabel(cargo: { currentSlotId: string | null; portions?: { currentSlotId: string | null }[] }) {
  const portions = cargo.portions ?? [];
  if (portions.length === 0) return cargo.currentSlotId ?? 'Rack slot unassigned';

  const assigned = portions.map((portion) => portion.currentSlotId).filter((slotId): slotId is string => Boolean(slotId));
  if (assigned.length === 0) return 'Rack slot unassigned';
  if (assigned.length < portions.length) return 'Partially assigned';

  const uniqueSlots = [...new Set(assigned)];
  return uniqueSlots.length === 1 ? uniqueSlots[0] : `${uniqueSlots.length} rack slots`;
}

function Pager({
  total,
  page,
  pageSize,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between text-xs text-slate-600 px-1">
      <span>{first}-{last} of {total}</span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="border rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
        >
          Prev
        </button>
        <span className="px-2 py-1">Page {page} / {totalPages}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="border rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
