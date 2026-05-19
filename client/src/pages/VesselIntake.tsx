import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, DuplicateEntry, DuplicateImportError, VesselManifestPreview, VesselManifestRow } from '../api.js';
import {
  emptyVesselCargoRowForm,
  VesselCargoRowForm,
  vesselCargoRowFormToManifestRow,
  VesselCargoRowFormValue,
} from '../components/VesselCargoRowForm.js';
import { companyName, titleCaseWords } from '../format.js';

type Tab = 'manual' | 'import';

const today = new Date().toISOString().slice(0, 10);

export function VesselIntake() {
  const [tab, setTab] = useState<Tab>('manual');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold">Vessel Intake</h2>
          <p className="text-sm text-slate-600">Manual vessel cargo entry and manifest imports for non-perishable general cargo.</p>
        </div>
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setTab('manual')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'manual' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Manual Entry
          </button>
          <button
            type="button"
            onClick={() => setTab('import')}
            className={`px-3 py-1.5 text-sm rounded ${tab === 'import' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Import Manifest
          </button>
        </div>
      </div>
      {tab === 'manual' ? <ManualVesselEntry /> : <ManifestImport />}
    </div>
  );
}

function ManualVesselEntry() {
  const qc = useQueryClient();
  const [vesselName, setVesselName] = useState('');
  const [arrivalDate, setArrivalDate] = useState(today);
  const [detailRow, setDetailRow] = useState<VesselCargoRowFormValue>(emptyVesselCargoRowForm);
  const [submitting, setSubmitting] = useState(false);
  const [detailSubmitting, setDetailSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateEntry[] | null>(null);

  async function handleUnidentifiedSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.createManualVesselCargo({ vesselName, arrivalDate });
      await qc.invalidateQueries({ queryKey: ['cargo'] });
      await qc.invalidateQueries({ queryKey: ['slots'] });
      setMessage('Created unidentified vessel intake item.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDetailedSubmit(e: FormEvent) {
    e.preventDefault();
    setDetailSubmitting(true);
    setError(null);
    setMessage(null);
    setDuplicates(null);
    try {
      await api.createDetailedManualVesselCargo({
        vesselName,
        arrivalDate,
        row: vesselCargoRowFormToManifestRow(detailRow),
      });
      await qc.invalidateQueries({ queryKey: ['cargo'] });
      await qc.invalidateQueries({ queryKey: ['slots'] });
      setDetailRow(emptyVesselCargoRowForm);
      setMessage('Created vessel cargo entry.');
    } catch (err) {
      if (err instanceof DuplicateImportError) {
        setDuplicates(err.duplicates);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setDetailSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="app-panel p-6 space-y-5">
        <Status error={error} message={message} />
        {duplicates && <DuplicateWarning duplicates={duplicates} onDismiss={() => setDuplicates(null)} />}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Vessel Name" required>
            <input className="input" value={vesselName} onChange={(e) => setVesselName(e.target.value)} required />
          </Field>
          <Field label="Arrival Date" required>
            <input type="date" className="input" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} required />
          </Field>
        </div>
      </div>

      <form onSubmit={handleDetailedSubmit} className="app-panel p-6 space-y-5">
        <div>
          <h3 className="font-bold">Enter Cargo Details</h3>
          <p className="text-sm text-slate-600">Create a vessel cargo item directly when the cargo details are already known.</p>
        </div>
        <VesselCargoRowForm value={detailRow} onChange={setDetailRow} />
        <button className="btn-primary" disabled={detailSubmitting || !vesselName || !arrivalDate}>
          {detailSubmitting ? 'Saving...' : 'Save Vessel Cargo'}
        </button>
      </form>

      <form onSubmit={handleUnidentifiedSubmit} className="app-panel p-6 space-y-4">
        <div>
          <h3 className="font-bold">Unidentified Intake</h3>
          <p className="text-sm text-slate-600">Use this when only the vessel and arrival are known. Match details later from the cargo screen.</p>
        </div>
        <button className="btn-secondary" disabled={submitting || !vesselName || !arrivalDate}>
          {submitting ? 'Saving...' : 'Save Unidentified Intake'}
        </button>
      </form>
    </div>
  );
}

type RowAction = 'import' | 'skip' | `merge:${string}`;

type BLGroup = { bl: string; indices: number[]; rows: VesselManifestRow[] };

function mergeRowGroup(rows: VesselManifestRow[]): VesselManifestRow {
  if (rows.length === 1) return rows[0];
  const first = rows[0];
  return {
    ...first,
    cargoDescription: rows.map((r) => r.cargoDescription).filter(Boolean).join(' / '),
    noOfPkgs: rows.reduce((sum, r) => sum + r.noOfPkgs, 0),
    remarks: rows.map((r) => r.remarks).filter(Boolean).join('; '),
  };
}

function ManifestImport() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<VesselManifestPreview | null>(null);
  const [rowActions, setRowActions] = useState<Record<number, RowAction>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateEntry[] | null>(null);

  const blGroups = useMemo<BLGroup[]>(() => {
    if (!preview) return [];
    const map = new Map<string, number[]>();
    preview.eligible.forEach((row, idx) => {
      const key = row.manifestRef.trim() || `__row_${idx}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(idx);
    });
    return [...map.entries()].map(([bl, indices]) => ({
      bl,
      indices,
      rows: indices.map((i) => preview.eligible[i]),
    }));
  }, [preview]);

  const selectedBLGroups = useMemo(
    () => blGroups.filter((g) => (rowActions[g.indices[0]] ?? 'import') === 'import'),
    [blGroups, rowActions],
  );
  const mergeBLGroups = useMemo(
    () => blGroups
      .map((g) => ({ group: g, action: rowActions[g.indices[0]] ?? 'import' }))
      .filter((item): item is { group: BLGroup; action: `merge:${string}` } => item.action.startsWith('merge:')),
    [blGroups, rowActions],
  );
  const unidentifiedQuery = useQuery({
    queryKey: ['cargo', 'vessel-unidentified', preview?.vesselName, preview?.arrivalDate],
    queryFn: () => api.listUnidentifiedVesselCargo(preview!.vesselName, preview!.arrivalDate),
    enabled: !!preview,
  });

  async function handleFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.previewVesselManifest(file);
      setPreview(result);
      setRowActions(Object.fromEntries(result.eligible.map((_, index) => [index, 'import' as RowAction])));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importSelected() {
    if (!preview || (selectedBLGroups.length === 0 && mergeBLGroups.length === 0)) return;
    const mergeCargoIds = mergeBLGroups.map(({ action }) => action.slice('merge:'.length));
    if (new Set(mergeCargoIds).size !== mergeCargoIds.length) {
      setError('Select each unidentified intake only once.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    setDuplicates(null);
    try {
      let imported = 0;
      if (selectedBLGroups.length > 0) {
        const result = await api.createVesselCargo({
          vesselName: preview.vesselName,
          arrivalDate: preview.arrivalDate,
          rows: selectedBLGroups.map((g) => mergeRowGroup(g.rows)),
        });
        imported = result.total;
      }
      for (const { group, action } of mergeBLGroups) {
        await api.mergeVesselRow(action.slice('merge:'.length), {
          vesselName: preview.vesselName,
          arrivalDate: preview.arrivalDate,
          row: mergeRowGroup(group.rows),
        });
      }
      await qc.invalidateQueries({ queryKey: ['cargo'] });
      await qc.invalidateQueries({ queryKey: ['slots'] });
      setMessage(`Imported ${imported} new cargo record(s) and merged ${mergeBLGroups.length} record(s).`);
      setPreview(null);
      setRowActions({});
    } catch (err) {
      if (err instanceof DuplicateImportError) {
        setDuplicates(err.duplicates);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  function setAction(index: number, action: RowAction) {
    const group = blGroups.find((g) => g.indices.includes(index));
    setRowActions((current) => {
      const next = { ...current };
      (group ? group.indices : [index]).forEach((i) => { next[i] = action; });
      return next;
    });
  }

  function includeExcluded(excludedIdx: number) {
    if (!preview) return;
    const newEligibleIdx = preview.eligible.length;
    setPreview((prev) => {
      if (!prev) return prev;
      const row = prev.excluded[excludedIdx];
      return {
        ...prev,
        eligible: [...prev.eligible, row],
        excluded: prev.excluded.filter((_, i) => i !== excludedIdx),
      };
    });
    setRowActions((prev) => ({ ...prev, [newEligibleIdx]: 'import' as RowAction }));
  }

  return (
    <div className="space-y-4">
      <div className="app-panel p-6 space-y-4">
        <Status error={error} message={message} />
        {duplicates && <DuplicateWarning duplicates={duplicates} onDismiss={() => setDuplicates(null)} />}
        <Field label="Manifest File">
          <input
            type="file"
            accept=".xls,.xlsx"
            className="input"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
        </Field>
      </div>

      {preview && (
        <>
          <div className="app-panel p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <div className="font-semibold">{preview.vesselName} - {preview.arrivalDate}</div>
              <div className="text-slate-600">
                {preview.eligible.length} eligible general cargo row(s), {preview.excluded.length} perishable row(s) excluded.
              </div>
            </div>
            <button className="btn-primary" disabled={busy || (selectedBLGroups.length === 0 && mergeBLGroups.length === 0)} onClick={importSelected}>
              {busy ? 'Saving...' : `Save ${selectedBLGroups.length} new / ${mergeBLGroups.length} merge`}
            </button>
          </div>

          <ManifestTable
            groups={blGroups}
            actions={rowActions}
            unidentified={unidentifiedQuery.data?.items ?? []}
            onAction={setAction}
          />

          {preview.excluded.length > 0 && (
            <section className="app-panel p-4 space-y-3">
              <div>
                <h3 className="font-bold text-sm">Excluded Perishable Cargo</h3>
                <p className="text-xs text-slate-500 mt-0.5">These rows were filtered out as perishable. Click Include if a row was filtered incorrectly.</p>
              </div>
              <ExcludedRows rows={preview.excluded} onInclude={includeExcluded} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ManifestTable({
  groups,
  actions,
  unidentified,
  onAction,
}: {
  groups: BLGroup[];
  actions: Record<number, RowAction>;
  unidentified: Awaited<ReturnType<typeof api.listUnidentifiedVesselCargo>>['items'];
  onAction: (index: number, action: RowAction) => void;
}) {
  return (
    <div className="app-panel overflow-x-auto">
      <table className="table-modern">
        <thead>
          <tr>
            <th>Action</th>
            <th>BL</th>
            <th>Consignee</th>
            <th>Mark</th>
            <th>Commodity</th>
            <th>Cargo Description</th>
            <th>Pkg</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 ? (
            <tr><td colSpan={8} className="text-slate-500">No eligible general cargo rows found.</td></tr>
          ) : groups.map((group) => {
            const firstIdx = group.indices[0];
            const firstRow = group.rows[0];
            const groupAction = actions[firstIdx] ?? 'import';
            const span = group.rows.length;
            return group.rows.map((row, pos) => (
              <tr key={`${group.bl}-${pos}`} className={pos > 0 ? 'border-t-0' : ''}>
                {pos === 0 && (
                  <td rowSpan={span} className="align-top">
                    <select
                      className="input min-w-56"
                      value={groupAction}
                      onChange={(e) => onAction(firstIdx, e.target.value as RowAction)}
                    >
                      <option value="import">Import as new</option>
                      <option value="skip">Skip</option>
                      {unidentified.map((cargo) => (
                        <option key={cargo.id} value={`merge:${cargo.id}`}>
                          Merge {cargo.cssCcdNo}{cargo.currentSlotId ? ` - ${cargo.currentSlotId}` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                {pos === 0 && <td rowSpan={span} className="align-top font-mono text-xs text-slate-700">{firstRow.manifestRef}</td>}
                {pos === 0 && <td rowSpan={span} className="align-top">{companyName(firstRow.consigneeName)}</td>}
                {pos === 0 && <td rowSpan={span} className="align-top">{firstRow.mark ? titleCaseWords(firstRow.mark) : '-'}</td>}
                {pos === 0 && <td rowSpan={span} className="align-top">General cargo</td>}
                <td>{titleCaseWords(row.cargoDescription)}</td>
                <td className="text-muted-value uppercase">{row.pkgsType}</td>
                <td className="text-muted-value tabular-nums">{row.noOfPkgs || '-'}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExcludedRows({ rows, onInclude }: { rows: VesselManifestRow[]; onInclude: (index: number) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-modern">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Consignee</th>
            <th>Mark</th>
            <th>Cargo Description</th>
            <th>Pkg</th>
            <th>Qty</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.manifestRef}-${row.cargoDescription}-${index}`}>
              <td className="font-mono text-xs text-slate-700">{row.manifestRef}</td>
              <td>{companyName(row.consigneeName)}</td>
              <td>{row.mark ? titleCaseWords(row.mark) : '-'}</td>
              <td>{titleCaseWords(row.cargoDescription)}</td>
              <td className="text-muted-value uppercase">{row.pkgsType}</td>
              <td className="text-muted-value tabular-nums">{row.noOfPkgs || '-'}</td>
              <td>
                <button
                  type="button"
                  onClick={() => onInclude(index)}
                  className="text-xs text-sky-600 hover:text-sky-800 font-medium whitespace-nowrap"
                >
                  Include
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicateWarning({ duplicates, onDismiss }: { duplicates: DuplicateEntry[]; onDismiss: () => void }) {
  return (
    <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded p-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">
          {duplicates.length === 1
            ? '1 entry already exists in the system and was not imported:'
            : `${duplicates.length} entries already exist in the system and were not imported:`}
        </p>
        <button type="button" onClick={onDismiss} className="text-amber-600 hover:text-amber-900 font-bold leading-none shrink-0">✕</button>
      </div>
      <ul className="space-y-0.5 pl-1">
        {duplicates.map((d) => (
          <li key={d.blNo} className="font-mono text-xs">
            {d.blNo} — {d.cssCcdNo} — {d.consigneeName}
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-700">Change the action to <strong>Skip</strong> for these rows, or search for them in the cargo list.</p>
    </div>
  );
}

function Status({ error, message }: { error: string | null; message: string | null }) {
  return (
    <>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{error}</div>}
      {message && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded p-3 text-sm">
          {message} <Link className="underline font-medium" to="/">View dashboard</Link>
        </div>
      )}
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-600 mb-1">
        {label}{required ? ' *' : ''}
      </span>
      {children}
    </label>
  );
}
