import { ReactNode, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, CargoStatus, RackReport } from '../api.js';
import { cargoTypeLabel, companyName, shortDate, shortDateTime } from '../format.js';

type Preset = 'week' | 'month' | 'custom';

const STATUS_LABELS: Record<CargoStatus, string> = {
  IN_RACK: 'In Rack',
  CHECKED_FOR_AUCTION: 'Checked for Auction',
  IN_CHECKING_AREA: 'In Checking Area',
  CLEARED: 'Cleared',
  MARKED_FOR_DISPOSAL: 'Marked for Disposal',
  DAMAGED: 'Damaged',
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date) {
  const out = new Date(d);
  const day = out.getDay() || 7;
  out.setDate(out.getDate() - day + 1);
  return out;
}

function defaultRange(preset: Preset) {
  const today = new Date();
  if (preset === 'week') return { start: isoDate(startOfWeek(today)), end: isoDate(today) };
  if (preset === 'month') return { start: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), end: isoDate(today) };
  return { start: isoDate(today), end: isoDate(today) };
}

function csvEscape(value: unknown) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function portionLabel(portion?: { label: string; quantity: number; pkgsType: string } | null) {
  return portion ? `${portion.label} (${portion.quantity} x ${portion.pkgsType})` : '';
}

function rackLocationLabel(cargo: { currentSlotId: string | null; portions?: { currentSlotId: string | null }[] }) {
  const portions = cargo.portions ?? [];
  if (portions.length === 0) return cargo.currentSlotId ?? '-';

  const assigned = portions.map((portion) => portion.currentSlotId).filter((slotId): slotId is string => Boolean(slotId));
  if (assigned.length === 0) return '-';
  if (assigned.length < portions.length) return 'Partially assigned';

  const uniqueSlots = [...new Set(assigned)];
  return uniqueSlots.length === 1 ? uniqueSlots[0] : `${uniqueSlots.length} rack slots`;
}

function rackStatusLabel(cargo: { status: CargoStatus; currentSlotId: string | null; portions?: { currentSlotId: string | null }[] }) {
  if (cargo.status !== 'IN_RACK' && cargo.status !== 'CHECKED_FOR_AUCTION') return STATUS_LABELS[cargo.status];

  const portions = cargo.portions ?? [];
  if (portions.length === 0) return cargo.currentSlotId ? STATUS_LABELS[cargo.status] : 'Rack Slot Unassigned';

  const assignedCount = portions.filter((portion) => portion.currentSlotId).length;
  if (assignedCount === 0) return 'Rack Slot Unassigned';
  if (assignedCount < portions.length) return 'Partially Assigned';
  return STATUS_LABELS[cargo.status];
}

function downloadCsv(report: RackReport) {
  const rows = [
    ['Activity', 'Date', 'Cargo ID', 'Type', 'BL', 'Portion', 'Consignee', 'Items', 'CBM', 'From', 'To', 'Status', 'By/Source'],
    ...report.intakes.map((c) => [
      'Intake',
      shortDateTime(c.createdAt),
      c.cssCcdNo,
      cargoTypeLabel(c.containerNo),
      c.blNo,
      '',
      companyName(c.consigneeName),
      c.noOfPkgs,
      c.cbm,
      '',
      rackLocationLabel(c),
      rackStatusLabel(c),
      '',
    ]),
    ...report.moves.map((m) => [
      'Move',
      shortDateTime(m.movedAt),
      m.cargo.cssCcdNo,
      cargoTypeLabel(m.cargo.containerNo),
      m.cargo.blNo,
      portionLabel(m.portion),
      companyName(m.cargo.consigneeName),
      '',
      '',
      m.fromSlotId ?? '',
      m.toSlotId ?? '',
      '',
      `${m.movedBy} / ${m.source}`,
    ]),
    ...report.freedCargo.map((c) => [
      'Status',
      shortDateTime(c.updatedAt),
      c.cssCcdNo,
      cargoTypeLabel(c.containerNo),
      c.blNo,
      '',
      companyName(c.consigneeName),
      '',
      '',
      '',
      '',
      c.status,
      '',
    ]),
  ];
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rack-report-${report.range.start.slice(0, 10)}-${report.range.end.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const initial = defaultRange('week');
  const [preset, setPreset] = useState<Preset>('week');
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);

  const { data, isLoading, error } = useQuery({
    queryKey: ['report', start, end],
    queryFn: () => api.rackReport(start, end),
  });

  function setPresetRange(next: Preset) {
    setPreset(next);
    if (next !== 'custom') {
      const range = defaultRange(next);
      setStart(range.start);
      setEnd(range.end);
    }
  }

  const statusRows = useMemo(() => {
    if (!data) return [];
    return Object.entries(STATUS_LABELS).map(([status, label]) => ({
      status: status as CargoStatus,
      label,
      count: data.summary.statusCounts[status as CargoStatus] ?? 0,
    }));
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <h2 className="text-xl font-bold">Rack Reports</h2>
          <p className="text-sm text-slate-600">Generate weekly, monthly, or custom rack activity reports.</p>
        </div>
        <div className="flex gap-2">
          <button disabled={!data} onClick={() => data && downloadCsv(data)} className="btn-secondary">CSV</button>
          <button onClick={() => window.print()} className="btn-primary">Print</button>
        </div>
      </div>

      <div className="app-panel p-4 flex flex-wrap items-end gap-3 print:hidden">
        <div className="flex gap-1">
          {(['week', 'month', 'custom'] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPresetRange(p)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${preset === p ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-300 bg-white hover:bg-slate-50'}`}
            >
              {p === 'week' ? 'Weekly' : p === 'month' ? 'Monthly' : 'Custom'}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Start</span>
          <input type="date" className="input" value={start} onChange={(e) => { setPreset('custom'); setStart(e.target.value); }} />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">End</span>
          <input type="date" className="input" value={end} onChange={(e) => { setPreset('custom'); setEnd(e.target.value); }} />
        </label>
      </div>

      {isLoading ? (
        <div>Loading...</div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{(error as Error).message}</div>
      ) : data ? (
        <ReportView report={data} statusRows={statusRows} />
      ) : null}
    </div>
  );
}

function ReportView({
  report,
  statusRows,
}: {
  report: RackReport;
  statusRows: { status: CargoStatus; label: string; count: number }[];
}) {
  return (
    <div className="space-y-5">
      <div className="app-panel p-6 space-y-1">
        <h1 className="text-2xl font-bold">MPL Smart Rack Report</h1>
        <div className="text-sm text-slate-600">
          {shortDate(report.range.start)} to {shortDate(report.range.end)} - Generated {shortDateTime(report.generatedAt)}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active Slots" value={report.summary.activeSlots} />
        <Stat label="Occupied" value={report.summary.occupiedSlots} />
        <Stat label="Empty Active" value={report.summary.emptyActiveSlots} />
        <Stat label="Overdue Cargo" value={report.summary.overdueCargo} tone={report.summary.overdueCargo > 0 ? 'red' : undefined} />
        <Stat label="Rack Slot Unassigned" value={report.summary.unassignedCargo} tone={report.summary.unassignedCargo > 0 ? 'red' : undefined} />
        <Stat label="Intakes" value={report.summary.intakes} />
        <Stat label="Intake Items" value={report.summary.intakeItems} />
        <Stat label="Intake CBM" value={report.summary.intakeCbm} />
        <Stat label="Customs Held" value={report.summary.intakeCustomsHeld} />
        <Stat label="Health Held" value={report.summary.intakeHealthHeld} />
        <Stat label="Moves" value={report.summary.moves} />
        <Stat label="Freed / Archived" value={report.summary.freedCargo} />
        <Stat label="Field Reports" value={report.summary.fieldReports} />
      </div>

      <Section title="Current Status Summary">
        <div className="grid md:grid-cols-2 gap-4">
          <Table headers={['Status', 'Cargo']}>
            {statusRows.map((r) => (
              <tr key={r.status}><td>{r.label}</td><td>{r.count}</td></tr>
            ))}
          </Table>
          <Table headers={['Row', 'Total', 'Active', 'Occupied', 'Overdue']}>
            {report.rowSummary.map((r) => (
              <tr key={r.row}><td>{r.row}</td><td>{r.total}</td><td>{r.active}</td><td>{r.occupied}</td><td>{r.overdue}</td></tr>
            ))}
          </Table>
        </div>
      </Section>

      <Section title="Intakes In Range">
        <Table headers={['Date', 'Cargo ID', 'Type', 'BL', 'Consignee', 'Items', 'CBM', 'Held', 'Slot', 'Status']}>
          {report.intakes.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap">{shortDate(c.createdAt)}</td>
              <td>{c.cssCcdNo}</td>
              <td>{cargoTypeLabel(c.containerNo)}</td>
              <td className="font-mono text-xs text-slate-700">{c.blNo}</td>
              <td>{companyName(c.consigneeName)}</td>
              <td>{c.noOfPkgs}</td>
              <td>{Number(c.cbm).toFixed(3)}</td>
              <td>{[c.detainedByCustoms && 'Customs', c.detainedByHealth && 'Health'].filter(Boolean).join(', ') || '-'}</td>
              <td>{rackLocationLabel(c)}</td>
              <td>{rackStatusLabel(c)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Movement History In Range">
        <Table headers={['Date', 'Type', 'BL', 'Portion', 'From', 'To', 'By', 'Source']}>
          {report.moves.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap">{shortDateTime(m.movedAt)}</td>
              <td>{cargoTypeLabel(m.cargo.containerNo)}</td>
              <td className="font-mono text-xs text-slate-700">{m.cargo.blNo}</td>
              <td>{portionLabel(m.portion) || '-'}</td>
              <td>{m.fromSlotId ?? '-'}</td>
              <td>{m.toSlotId ?? '-'}</td>
              <td>{m.movedBy}</td>
              <td>{m.source}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Freed / Archived Cargo In Range">
        <Table headers={['Date', 'Cargo ID', 'Type', 'BL', 'Consignee', 'Status']}>
          {report.freedCargo.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap">{shortDateTime(c.updatedAt)}</td>
              <td>{c.cssCcdNo}</td>
              <td>{cargoTypeLabel(c.containerNo)}</td>
              <td className="font-mono text-xs text-slate-700">{c.blNo}</td>
              <td>{companyName(c.consigneeName)}</td>
              <td>{STATUS_LABELS[c.status]}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Field Reports In Range">
        <Table headers={['Date', 'Type', 'BL', 'Reported By', 'Note']}>
          {report.fieldReports.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{shortDateTime(r.reportedAt)}</td>
              <td>{cargoTypeLabel(r.cargo.containerNo)}</td>
              <td className="font-mono text-xs text-slate-700">{r.cargo.blNo}</td>
              <td>{r.reportedBy}</td>
              <td>{r.note}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className={`metric-card ${tone === 'red' ? 'border-red-200 text-red-700 bg-red-50' : ''}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold">{Number.isInteger(value) ? value : value.toFixed(3)}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="app-panel p-4 space-y-3">
      <h3 className="font-bold">{title}</h3>
      {children}
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  return (
    <div className="overflow-x-auto">
      <table className="table-modern">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>{headers.map((h) => <th key={h} className="text-left px-3 py-2">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y [&_td]:px-3 [&_td]:py-2">
          {Array.isArray(rows) && rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="text-slate-500">No records in this range.</td></tr>
          ) : rows}
        </tbody>
      </table>
    </div>
  );
}
