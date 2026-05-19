import { useEffect, useMemo, useRef, useState, FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, CargoStatus } from '../api.js';
import { ShiftingSlipForm } from '../components/ShiftingSlipForm.js';
import {
  emptyVesselCargoRowForm,
  VesselCargoRowForm,
  vesselCargoRowFormToManifestRow,
  VesselCargoRowFormValue,
} from '../components/VesselCargoRowForm.js';
import { companyName } from '../format.js';

const ARCHIVED_STATUSES: CargoStatus[] = ['CLEARED', 'IN_CHECKING_AREA', 'DAMAGED'];

function prettyStatus(s: CargoStatus) {
  return s.replace(/_/g, ' ');
}

export function CargoDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: cargo, isLoading } = useQuery({
    queryKey: ['cargo', id],
    queryFn: () => api.getCargo(id!),
    enabled: !!id,
  });
  const { data: slots } = useQuery({ queryKey: ['slots'], queryFn: api.slots });
  const [slotTarget, setSlotTarget] = useState('');
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [movingPortionId, setMovingPortionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [matchRow, setMatchRow] = useState<VesselCargoRowFormValue>(emptyVesselCargoRowForm);
  const [matchMsg, setMatchMsg] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<{ id: string; blNo: string; consigneeName: string; mark: string; cargoDescription: string; pkgsType: string; noOfPkgs: number; remarks: string }[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [splitQty, setSplitQty] = useState(1);
  const [splitResult, setSplitResult] = useState<{ split: { label: string; quantity: number; pkgsType: string } } | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const isUnidentifiedManualVesselIntakeDerived =
    cargo != null &&
    cargo.containerNo === 'VESSEL' &&
    cargo.blNo === 'PENDING' &&
    cargo.reasonOfShifting === 'Manual vessel intake';

  useEffect(() => {
    if (!isUnidentifiedManualVesselIntakeDerived || !cargo) return;
    const q = matchRow.manifestRef.trim() || matchRow.consigneeName.trim();
    if (q.length < 2) {
      setLookupResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLookupLoading(true);
      try {
        const res = await api.lookupVesselCargo(cargo.vesselName, cargo.dateOfArrival.slice(0, 10), q);
        if (mountedRef.current) setLookupResults(res.items);
      } catch {
        if (mountedRef.current) setLookupResults([]);
      } finally {
        if (mountedRef.current) setLookupLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [matchRow.manifestRef, matchRow.consigneeName, isUnidentifiedManualVesselIntakeDerived, cargo]);

  if (isLoading || !cargo) return <div>Loading…</div>;

  const isVesselIntake = cargo.containerNo === 'VESSEL' || cargo.reasonOfShifting === 'Vessel intake';
  const cargoTypeLabel = cargo.containerNo === 'VESSEL' ? 'General Cargo' : 'Container';
  const isUnidentifiedManualVesselIntake =
    cargo.containerNo === 'VESSEL' &&
    cargo.blNo === 'PENDING' &&
    cargo.reasonOfShifting === 'Manual vessel intake';
  const targetSlots = (slots ?? []).filter((s) => s.isActive);
  const selectedSlot = slotTarget ? targetSlots.find((s) => s.id === slotTarget) : null;
  const portions = cargo.portions ?? [];
  const hasPortions = portions.length > 0;
  const movingPortion = movingPortionId ? portions.find((p) => p.id === movingPortionId) ?? null : null;

  async function handleMove(toSlotId: string | null, portionId?: string | null) {
    if (ARCHIVED_STATUSES.includes(cargo!.status)) {
      const dest = toSlotId ? `slot ${toSlotId}` : 'rack slot unassigned';
      const ok = window.confirm(
        `This cargo is currently marked ${prettyStatus(cargo!.status)} and is not in active rack rotation.\n\nMove it to ${dest} anyway?`,
      );
      if (!ok) return;
    }
    if (toSlotId) {
      const target = targetSlots.find((s) => s.id === toSlotId);
      const cargoOccupants = target?.cargos.filter(
        (c) =>
          c.id !== cargo!.id &&
          (c.status === 'IN_RACK' || c.status === 'CHECKED_FOR_AUCTION'),
      ) ?? [];
      const portionOccupants = target?.portions.filter(
        (p) =>
          p.id !== portionId &&
          (p.status === 'IN_RACK' || p.status === 'CHECKED_FOR_AUCTION'),
      ) ?? [];
      const occupants = [
        ...cargoOccupants.map((c) => cargoDisplayName(c.containerNo)),
        ...portionOccupants.map((p) => `${cargoDisplayName(p.cargo.containerNo)} ${p.label}`),
      ];
      if (occupants.length > 0) {
        const ok = window.confirm(
          `Slot ${toSlotId} already has ${occupants.length} active intake item(s): ${occupants
            .join(', ')}.\n\nSmall items can share a slot, but please confirm you really want to move this cargo into the same rack slot.`,
        );
        if (!ok) return;
      }
    }
    const itemName = portionId ? (movingPortion?.label ?? 'portion') : cargoDisplayName(cargo!.containerNo);
    const ok = window.confirm(
      `Move ${itemName} to ${toSlotId ? `slot ${toSlotId}` : 'rack slot unassigned'}?`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      if (portionId) await api.moveCargoPortion(cargo!.id, portionId, toSlotId);
      else await api.moveCargo(cargo!.id, toSlotId);
      qc.invalidateQueries({ queryKey: ['cargo', cargo!.id] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['cargo'] });
      setMovePickerOpen(false);
      setMovingPortionId(null);
      setSlotTarget('');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleStatus(status: CargoStatus) {
    if (ARCHIVED_STATUSES.includes(cargo!.status) && status !== cargo!.status) {
      const ok = window.confirm(
        `This cargo is currently marked ${prettyStatus(cargo!.status)}.\n\nChange status to ${prettyStatus(status)}?`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      await api.setStatus(cargo!.id, status);
      qc.invalidateQueries({ queryKey: ['cargo', cargo!.id] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['cargo'] });
    } catch (e) {
      const m = (e as Error).message;
      const match = m.match(/^409 (.+)$/);
      if (match) {
        try {
          const body = JSON.parse(match[1]) as { error: string; slotId?: string; containerNo?: string };
          if (body.error === 'no_previous_slot') {
            setStatusMsg('No previous slot on record. Use the rack map to place this cargo in a slot.');
          } else if (body.error === 'previous_slot_unavailable') {
            setStatusMsg(`Previous slot ${body.slotId} no longer exists or is disabled. Use the rack map to pick another.`);
          } else if (body.error === 'previous_slot_occupied') {
            setStatusMsg(`Previous slot ${body.slotId} is now occupied by ${body.containerNo}. Use the rack map to pick another.`);
          } else {
            setStatusMsg(`Failed: ${body.error}`);
          }
          return;
        } catch {
          /* fall through */
        }
      }
      setStatusMsg(m);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleUpload(e: FormEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadPhoto(cargo!.id, file);
      qc.invalidateQueries({ queryKey: ['cargo', cargo!.id] });
    } finally {
      if (mountedRef.current) setBusy(false);
      if (e.currentTarget) e.currentTarget.value = '';
    }
  }

  async function handleEdit(data: Record<string, unknown>) {
    setBusy(true);
    setStatusMsg(null);
    try {
      await api.updateCargo(cargo!.id, data as never);
      await qc.invalidateQueries({ queryKey: ['cargo', cargo!.id] });
      await qc.invalidateQueries({ queryKey: ['cargo'] });
      setEditing(false);
    } catch (e) {
      const m = (e as Error).message;
      const match409 = m.match(/^409 (.+)$/s);
      if (match409) {
        try {
          const body = JSON.parse(match409[1]) as { error: string; cssCcdNo?: string; currentSlotId?: string | null; noOfPkgs?: number; pkgsType?: string };
          if (body.error === 'bl_already_in_rack') {
            setStatusMsg(
              `BL "${matchRow.manifestRef}" is already in rack slot ${body.currentSlotId} as ${body.cssCcdNo} (${body.noOfPkgs} × ${body.pkgsType}). Cannot merge — that BL is already physically accounted for.`,
            );
            return;
          }
        } catch { /* fall through */ }
      }
      setStatusMsg(m);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleDeletePortion(portionId: string, portionLabel: string) {
    const recipient = [...portions]
      .filter((p) => p.id !== portionId)
      .sort((a, b) => b.quantity - a.quantity)[0];
    const isLast = portions.length === 2;
    const msg = isLast
      ? `Delete ${portionLabel}? Its packages will be merged into ${recipient?.label ?? 'the remaining portion'}, reverting this intake to a single unsplit portion.`
      : `Delete ${portionLabel}? Its packages will be merged into ${recipient?.label ?? 'another portion'}.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api.deletePortion(cargo!.id, portionId);
      await qc.invalidateQueries({ queryKey: ['cargo', cargo!.id] });
      await qc.invalidateQueries({ queryKey: ['cargo'] });
      await qc.invalidateQueries({ queryKey: ['slots'] });
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleSplit(e: FormEvent) {
    e.preventDefault();
    setSplitError(null);
    setSplitResult(null);
    setBusy(true);
    try {
      const result = await api.splitCargo(cargo!.id, splitQty);
      await qc.invalidateQueries({ queryKey: ['cargo', cargo!.id] });
      await qc.invalidateQueries({ queryKey: ['cargo'] });
      await qc.invalidateQueries({ queryKey: ['slots'] });
      setSplitQty(1);
      setSplitResult({ split: result.split });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('split_qty_must_be_less_than_total')) setSplitError('Split quantity must be less than the total packages.');
      else if (msg.includes('cargo_has_insufficient_packages')) setSplitError('Cargo must have more than 1 package to split.');
      else setSplitError(msg);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleMatchSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatusMsg(null);
    setMatchMsg(null);
    try {
      await api.mergeVesselRow(cargo!.id, {
        vesselName: cargo!.vesselName,
        arrivalDate: cargo!.dateOfArrival.slice(0, 10),
        row: vesselCargoRowFormToManifestRow(matchRow),
      });
      await qc.invalidateQueries({ queryKey: ['cargo', cargo!.id] });
      await qc.invalidateQueries({ queryKey: ['cargo'] });
      await qc.invalidateQueries({ queryKey: ['slots'] });
      setMatchRow(emptyVesselCargoRowForm);
      setLookupResults([]);
      setMatchMsg('Cargo details matched.');
    } catch (e) {
      setStatusMsg((e as Error).message);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="app-panel p-6 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold">{cargoTypeLabel}</h2>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${cargo.isOverdue ? 'text-red-600' : 'text-emerald-600'}`}>
              {cargo.isOverdue ? 'OVERDUE (30d+)' : displayStatus(cargo.status, cargo.currentSlotId, portions)}
            </span>
            <button
              onClick={() => setEditing((v) => !v)}
              className="border rounded px-3 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-300"
            >
              {editing ? 'Cancel edit' : 'Edit intake'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <KV k="Cargo ID" v={cargo.cssCcdNo} />
          <KV k="Type" v={cargoTypeLabel} />
          {cargo.containerNo !== 'VESSEL' && <KV k="Container No" v={cargo.containerNo} />}
          <KV k="BL No" v={cargo.blNo} />
          <KV k="Consignee" v={companyName(cargo.consigneeName)} />
          {isVesselIntake && <KV k="Mark" v={cargo.mark || '-'} />}
          {isVesselIntake && <KV k="Commodity" v={cargo.commodity || 'GENERAL CARGO'} />}
          {isVesselIntake && <KV k="Cargo Description" v={cargo.cargoDescription || '-'} />}
          <KV k="Vessel" v={cargo.vesselName} />
          <KV k="Arrival" v={cargo.dateOfArrival.slice(0, 10)} />
          <KV k="Shifted" v={cargo.shiftedDate.slice(0, 10)} />
          <KV k="Packages" v={`${cargo.noOfPkgs} × ${cargo.pkgsType}`} />
          <KV k="CBM" v={String(cargo.cbm)} />
          {!isVesselIntake && <KV k="Container Size" v={cargo.containerSize} />}
          {!isVesselIntake && <KV k="FCL/LCL" v={cargo.fclLcl} />}
          <KV k="Current Slot" v={hasPortions ? portionSlotSummary(portions) : cargo.currentSlotId ?? 'Rack slot unassigned'} />
          <KV k="Detained" v={[cargo.detainedByCustoms && 'Customs', cargo.detainedByHealth && 'Health'].filter(Boolean).join(', ') || 'No'} />
        </div>
        {cargo.remarks && <div className="text-sm text-slate-700 dark:text-slate-300"><b>Remarks:</b> {cargo.remarks}</div>}
        {cargo.reasonOfShifting && <div className="text-sm text-slate-700 dark:text-slate-300"><b>Reason:</b> {cargo.reasonOfShifting}</div>}
      </div>

      {editing && (
        <div>
          <ShiftingSlipForm
            initialCargo={cargo}
            onSubmit={handleEdit}
            submitting={busy}
            title="Edit Cargo Shifting Slip"
            submitLabel="Save Changes"
            showInitialSlot={false}
            vesselMode={isVesselIntake}
          />
          {statusMsg && <div className="mt-2 text-sm text-red-600">{statusMsg}</div>}
        </div>
      )}

      {isUnidentifiedManualVesselIntake && (
        <form onSubmit={handleMatchSubmit} className="app-panel p-6 space-y-5">
          <div>
            <h3 className="font-bold">Match / Merge Cargo Details</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Fill the cargo details for this unidentified vessel intake item.
            </p>
          </div>
          <VesselCargoRowForm value={matchRow} onChange={(next) => { setMatchRow(next); setMatchMsg(null); }} />
          {(lookupLoading || lookupResults.length > 0) && (
            <div className="border border-sky-200 rounded-lg bg-sky-50 p-3 space-y-2 dark:border-sky-700/50 dark:bg-sky-900/30">
              <div className="text-xs font-semibold text-sky-700">
                {lookupLoading ? 'Searching…' : `${lookupResults.length} match${lookupResults.length !== 1 ? 'es' : ''} found — click to auto-fill`}
              </div>
              {lookupResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setMatchRow({
                      manifestRef: item.blNo,
                      consigneeName: item.consigneeName,
                      mark: item.mark,
                      cargoDescription: item.cargoDescription,
                      pkgsType: item.pkgsType || 'PKG',
                      noOfPkgs: item.noOfPkgs,
                      remarks: item.remarks,
                    });
                    setLookupResults([]);
                  }}
                  className="w-full text-left rounded border border-sky-200 bg-white px-3 py-2 text-sm hover:border-sky-400 hover:bg-sky-100 transition dark:border-sky-700 dark:bg-slate-700 dark:hover:bg-sky-900/40"
                >
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{item.blNo}</span>
                  <span className="mx-2 text-slate-400">·</span>
                  <span className="text-slate-600 dark:text-slate-400">{companyName(item.consigneeName)}</span>
                  {item.cargoDescription && (
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">— {item.cargoDescription}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Saving...' : 'Save Matched Details'}
            </button>
            {matchMsg && <span className="text-sm text-emerald-700">{matchMsg}</span>}
          </div>
          {statusMsg && <div className="text-sm text-red-600">{statusMsg}</div>}
        </form>
      )}

      <div className="app-panel p-6 space-y-4">
        <h3 className="font-bold">Move</h3>
        {hasPortions ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-600 dark:text-slate-400">
              Package portions for this intake can be moved independently while staying under {cargo.cssCcdNo}.
            </div>
            <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Portion</th>
                    <th className="px-3 py-2 text-left">Packages</th>
                    <th className="px-3 py-2 text-left">Rack Slot</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {portions.map((portion) => (
                    <tr key={portion.id}>
                      <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{portion.label}</td>
                      <td className="px-3 py-2">{portion.quantity} x {portion.pkgsType}</td>
                      <td className="px-3 py-2">{portion.currentSlotId ?? 'Rack slot unassigned'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            disabled={busy}
                            onClick={() => {
                              setMovingPortionId(portion.id);
                              setSlotTarget(portion.currentSlotId ?? '');
                              setMovePickerOpen(true);
                            }}
                            className="btn-secondary"
                          >
                            Move
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => handleDeletePortion(portion.id, portion.label)}
                            className="rounded px-2.5 py-1 text-sm bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700/50 dark:hover:bg-red-900/40"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-600 dark:text-slate-400">
              Current slot: <span className="font-semibold text-slate-900 dark:text-slate-100">{cargo.currentSlotId ?? 'Rack slot unassigned'}</span>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                setMovingPortionId(null);
                setSlotTarget(cargo.currentSlotId ?? '');
                setMovePickerOpen(true);
              }}
              className="btn-primary"
            >
              Move
            </button>
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">Status actions</div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => handleStatus(cargo.status === 'CHECKED_FOR_AUCTION' ? 'IN_RACK' : 'CHECKED_FOR_AUCTION')}
              className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 transition ${
                cargo.status === 'CHECKED_FOR_AUCTION'
                  ? 'bg-amber-600 text-white ring-2 ring-amber-800 ring-offset-1 hover:bg-amber-700'
                  : 'bg-amber-500 text-white hover:bg-amber-600'
              }`}
            >
              {cargo.status === 'CHECKED_FOR_AUCTION' ? 'Checked for Auction ✓' : 'Check for Auction'}
            </button>
            <button
              disabled={busy || (!cargo.currentSlotId && !cargo.portions?.some((p) => p.currentSlotId))}
              onClick={() => handleStatus('IN_CHECKING_AREA')}
              title={cargo.currentSlotId || cargo.portions?.some((p) => p.currentSlotId) ? 'Move out of rack to the Checking Area' : 'Not in a rack slot'}
              className="bg-indigo-600 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-indigo-700"
            >
              Move to Checking Area
            </button>
            <button
              disabled={busy || cargo.status === 'CLEARED'}
              onClick={() => handleStatus('CLEARED')}
              className="bg-slate-700 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-slate-800"
            >
              Mark Cleared
            </button>
            <button
              disabled={busy}
              onClick={() => handleStatus(cargo.status === 'MARKED_FOR_DISPOSAL' ? 'IN_RACK' : 'MARKED_FOR_DISPOSAL')}
              className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 transition ${
                cargo.status === 'MARKED_FOR_DISPOSAL'
                  ? 'bg-orange-600 text-white ring-2 ring-orange-800 ring-offset-1 hover:bg-orange-700'
                  : 'bg-orange-500 text-white hover:bg-orange-600'
              }`}
            >
              {cargo.status === 'MARKED_FOR_DISPOSAL' ? 'Marked for Disposal ✓' : 'Mark for Disposal'}
            </button>
            {cargo.status !== 'IN_RACK' && cargo.status !== 'CHECKED_FOR_AUCTION' && cargo.status !== 'MARKED_FOR_DISPOSAL' && (
              <button
                disabled={busy}
                onClick={() => handleStatus('IN_RACK')}
                title={cargo.currentSlotId ? 'Clear status, keep current slot' : 'Restore to the previous rack slot if still free'}
                className="bg-emerald-600 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50 hover:bg-emerald-700"
              >
                {cargo.currentSlotId ? 'Revert to In Rack' : 'Restore to last slot'}
              </button>
            )}
          </div>
          {statusMsg && <div className="text-xs text-slate-700 dark:text-slate-300">{statusMsg}</div>}
        </div>

        {cargo.noOfPkgs > 1 && !ARCHIVED_STATUSES.includes(cargo.status) && (
          <div className="border-t pt-3 space-y-3">
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">Split intake</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Split this intake into package portions so each portion can be placed in a different rack slot while staying on this record.
            </p>
            <form onSubmit={handleSplit} className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Packages to split off <span className="font-normal text-slate-400">(1 – {cargo.noOfPkgs - 1})</span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={cargo.noOfPkgs - 1}
                  value={splitQty}
                  onChange={(e) => { setSplitQty(Number(e.target.value)); setSplitResult(null); setSplitError(null); }}
                  className="input w-28"
                  required
                />
              </label>
              <div className="text-xs text-slate-500 dark:text-slate-400 pb-2">
                Result: <span className="font-semibold text-slate-700 dark:text-slate-300">{splitQty} x {cargo.pkgsType}</span> new unassigned portion on this intake
              </div>
              <button type="submit" disabled={busy || splitQty < 1 || splitQty >= cargo.noOfPkgs} className="btn-secondary pb-2 self-end">
                {busy ? 'Splitting…' : 'Split'}
              </button>
            </form>
            {splitError && <div className="text-xs text-red-600">{splitError}</div>}
            {splitResult && (
              <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 space-y-1 dark:bg-emerald-900/30 dark:border-emerald-700/50 dark:text-emerald-300">
                <div>Split complete. <strong>{splitResult.split.label}</strong> has <strong>{splitResult.split.quantity} x {splitResult.split.pkgsType}</strong> and stays on this intake.</div>
              </div>
            )}
          </div>
        )}
      </div>

      {movePickerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 px-4 py-6">
          <div className="mx-auto flex max-h-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                <h3 className="font-bold">Move {movingPortion ? `${movingPortion.label} of ${cargoDisplayName(cargo.containerNo)}` : cargoDisplayName(cargo.containerNo)}</h3>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Target: <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedSlot?.id ?? 'Rack slot unassigned'}</span>
                </div>
              </div>
              <button
                disabled={busy}
                onClick={() => {
                  setMovePickerOpen(false);
                  setMovingPortionId(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              <RackMoveMap
                slots={targetSlots}
                cargoId={cargo.id}
                currentSlotId={movingPortion ? movingPortion.currentSlotId : cargo.currentSlotId}
                movingPortionId={movingPortionId}
                selectedSlotId={slotTarget}
                onSelect={setSlotTarget}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
              <button
                disabled={busy}
                onClick={() => setSlotTarget('')}
                className={`btn-secondary ${slotTarget === '' ? 'ring-2 ring-sky-200 border-sky-400' : ''}`}
              >
                Rack slot unassigned
              </button>
              <button
                disabled={busy || (slotTarget || null) === (movingPortion ? movingPortion.currentSlotId : cargo.currentSlotId)}
                onClick={() => handleMove(slotTarget || null, movingPortionId)}
                className="btn-primary"
              >
                {busy ? 'Moving...' : 'Approve Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="app-panel p-6 space-y-3">
        <h3 className="font-bold">Photos</h3>
        <input type="file" accept="image/*" onChange={handleUpload} disabled={busy} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(cargo.photos ?? []).map((p) => (
            <a key={p.id} href={`/uploads/${p.filePath}`} target="_blank" rel="noreferrer" className="block">
              <img src={`/uploads/${p.filePath}`} alt={p.caption ?? ''} className="w-full h-32 object-cover rounded border" />
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{p.kind} · {p.uploadedBy}</div>
            </a>
          ))}
        </div>
      </div>

      {cargo.reports && cargo.reports.length > 0 && (
        <div className="app-panel p-6 space-y-3">
          <h3 className="font-bold">Field Reports</h3>
          <ul className="text-sm divide-y">
            {cargo.reports.map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>by {r.reportedBy}</span>
                  <span>{new Date(r.reportedAt).toLocaleString()}</span>
                </div>
                <div>{r.note}</div>
                {r.photo && (
                  <img src={`/uploads/${r.photo.filePath}`} className="mt-2 max-h-48 rounded border" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="app-panel p-6 space-y-3">
        <h3 className="font-bold">Move History</h3>
        <ul className="text-sm divide-y">
          {(cargo.moveLogs ?? []).map((m) => (
            <li key={m.id} className="py-2 flex justify-between">
              <span>{m.fromSlot?.id ?? '—'} → {m.toSlot?.id ?? '—'}</span>
              <span className="text-slate-500 text-xs dark:text-slate-400">
                {m.user ? `${m.user.name} (${m.user.username})` : m.movedBy} · {m.source} · {new Date(m.movedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}

function displayStatus(
  status: CargoStatus,
  currentSlotId: string | null,
  portions: NonNullable<Awaited<ReturnType<typeof api.getCargo>>['portions']>,
) {
  if (status === 'IN_RACK' && portions.length > 0) {
    return portions.some((portion) => !portion.currentSlotId) ? 'PARTIALLY ASSIGNED' : 'IN_RACK';
  }
  if (status === 'IN_RACK' && !currentSlotId) return 'RACK SLOT UNASSIGNED';
  return status;
}

function portionSlotSummary(portions: NonNullable<Awaited<ReturnType<typeof api.getCargo>>['portions']>) {
  const slots = portions.map((portion) => portion.currentSlotId).filter(Boolean);
  if (slots.length === 0) return 'Rack slot unassigned';
  const unique = [...new Set(slots)];
  return unique.length === 1 ? unique[0]! : `${unique.length} rack slots`;
}

function cargoDisplayName(containerNo: string) {
  return containerNo === 'VESSEL' ? 'General Cargo' : containerNo;
}

type MoveSlot = Awaited<ReturnType<typeof api.slots>>[number];

function RackMoveMap({
  slots,
  cargoId,
  currentSlotId,
  movingPortionId,
  selectedSlotId,
  onSelect,
}: {
  slots: MoveSlot[];
  cargoId: string;
  currentSlotId: string | null;
  movingPortionId: string | null;
  selectedSlotId: string;
  onSelect: (slotId: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, Map<number, MoveSlot[]>>();
    for (const slot of slots) {
      if (!map.has(slot.row)) map.set(slot.row, new Map());
      const levels = map.get(slot.row)!;
      if (!levels.has(slot.level)) levels.set(slot.level, []);
      levels.get(slot.level)!.push(slot);
    }
    for (const levels of map.values()) {
      for (const rowSlots of levels.values()) rowSlots.sort((a, b) => a.slot - b.slot);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  if (slots.length === 0) {
    return <div className="app-muted-panel p-4 text-sm text-slate-500 dark:text-slate-400">No active rack slots are available.</div>;
  }

  return (
    <div className="space-y-4">
      {grouped.map(([row, levels]) => {
        const levelNos = [...levels.keys()].sort((a, b) => b - a);
        const slotsPerLevel = Math.max(...[...levels.values()].map((arr) => arr.length));
        return (
          <div key={row} className="app-muted-panel p-3">
            <div className="font-semibold text-sm mb-2">Row {row}</div>
            <div className="space-y-2">
              {levelNos.map((level) => (
                <div key={level} className="flex items-center gap-2">
                  <div className="w-10 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">L{level}</div>
                  <div className="grid gap-1 flex-1" style={{ gridTemplateColumns: `repeat(${slotsPerLevel}, minmax(0, 1fr))` }}>
                    {(levels.get(level) ?? []).map((slot) => {
                      const cargoOccupants = slot.cargos.filter(
                        (c) =>
                          c.id !== cargoId &&
                          (c.status === 'IN_RACK' || c.status === 'CHECKED_FOR_AUCTION'),
                      );
                      const portionOccupants = slot.portions.filter(
                        (p) =>
                          p.id !== movingPortionId &&
                          (p.status === 'IN_RACK' || p.status === 'CHECKED_FOR_AUCTION'),
                      );
                      const selected = selectedSlotId === slot.id;
                      const current = currentSlotId === slot.id;
                      const occupantCount = cargoOccupants.length + portionOccupants.length;
                      const occupied = occupantCount > 0;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => onSelect(slot.id)}
                          title={occupied ? `${occupantCount} active item(s) in slot` : 'Empty slot'}
                          className={`min-h-16 rounded-md border px-2 py-2 text-xs text-center shadow-sm transition ${
                            selected
                              ? 'border-sky-500 bg-sky-100 text-sky-900 ring-2 ring-sky-200 dark:bg-sky-900 dark:text-sky-100 dark:ring-sky-700'
                              : current
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : occupied
                                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:border-sky-500 dark:hover:bg-sky-900/30'
                          }`}
                        >
                          <div className="font-semibold">{slot.id}</div>
                          <div className="truncate">
                            {current ? 'current' : occupied ? `${occupantCount} in slot` : 'empty'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
