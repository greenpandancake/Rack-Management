import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, Cargo, Slot } from '../api.js';
import { activeSlotOccupants } from './SlotCell.js';

type Props = {
  onSubmit: (data: Record<string, unknown>) => Promise<void> | void;
  submitting?: boolean;
  initialCargo?: Cargo;
  submitLabel?: string;
  title?: string;
  showInitialSlot?: boolean;
  vesselMode?: boolean;
};

type CargoType = 'CONTAINER' | 'GENERAL_CARGO';

export function ShiftingSlipForm({
  onSubmit,
  submitting,
  initialCargo,
  submitLabel = 'Save Intake',
  title = 'Cargo Shifting Slip',
  showInitialSlot = true,
  vesselMode = false,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const initialCargoType: CargoType = initialCargo?.containerNo === 'VESSEL' || vesselMode ? 'GENERAL_CARGO' : 'CONTAINER';
  const [cargoType, setCargoType] = useState<CargoType>(initialCargoType);
  const [form, setForm] = useState({
    vesselName: initialCargo?.vesselName ?? '',
    dateOfArrival: initialCargo?.dateOfArrival.slice(0, 10) ?? today,
    containerNo: initialCargo?.containerNo === 'VESSEL' ? '' : initialCargo?.containerNo ?? '',
    blNo: initialCargo?.blNo ?? '',
    consigneeName: initialCargo?.consigneeName ?? '',
    mark: initialCargo?.mark ?? '',
    commodity: initialCargo?.commodity ?? (initialCargoType === 'GENERAL_CARGO' ? 'GENERAL CARGO' : ''),
    cargoDescription: initialCargo?.cargoDescription ?? '',
    pkgsType: initialCargo?.pkgsType ?? 'Carton',
    noOfPkgs: initialCargo?.noOfPkgs ?? 1,
    cbm: Number(initialCargo?.cbm ?? 0),
    fclLcl: initialCargo?.fclLcl ?? 'LCL' as 'FCL' | 'LCL',
    containerSize: initialCargo?.containerSize ?? 'FT20' as 'FT20' | 'FT40' | 'NA',
    detainedByCustoms: initialCargo?.detainedByCustoms ?? false,
    detainedByHealth: initialCargo?.detainedByHealth ?? false,
    detainedCargoRefNo: initialCargo?.detainedCargoRefNo ?? '',
    reasonOfShifting: initialCargo?.reasonOfShifting ?? '',
    clearanceOfficer: initialCargo?.clearanceOfficer ?? '',
    clearanceEmployId: initialCargo?.clearanceEmployId ?? '',
    shiftedDate: initialCargo?.shiftedDate.slice(0, 10) ?? today,
    remarks: initialCargo?.remarks ?? '',
    currentSlotId: initialCargo?.currentSlotId ?? '',
  });

  const { data: slots } = useQuery({ queryKey: ['slots'], queryFn: api.slots });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const activeSlots = (slots ?? []).filter((s: Slot) => s.isActive);
  const selectedSlot = activeSlots.find((s) => s.id === form.currentSlotId);
  const selectedOccupants = selectedSlot ? activeSlotOccupants(selectedSlot) : [];
  const isGeneralCargo = cargoType === 'GENERAL_CARGO';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (showInitialSlot && selectedSlot && selectedOccupants.length > 0) {
      const ok = window.confirm(
        `Slot ${selectedSlot.id} already has ${selectedOccupants.length} active intake item(s): ${selectedOccupants
          .map((c) => c.label ?? cargoDisplayName(c.containerNo))
          .join(', ')}.\n\nSmall items can share a slot, but please confirm you really want to store this intake in the same rack slot.`,
      );
      if (!ok) return;
    }
    await onSubmit({
      ...form,
      containerNo: isGeneralCargo ? 'VESSEL' : form.containerNo,
      commodity: isGeneralCargo ? 'GENERAL CARGO' : form.commodity,
      fclLcl: isGeneralCargo ? 'LCL' : form.fclLcl,
      containerSize: isGeneralCargo ? 'NA' : form.containerSize,
      ...(showInitialSlot ? { currentSlotId: form.currentSlotId || null } : {}),
      detainedCargoRefNo: form.detainedCargoRefNo || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="app-panel p-6 space-y-6">
      <div className="flex items-center justify-between border-b pb-3">
        <h2 className="text-xl font-bold">{title}</h2>
        <span className="text-xs text-slate-500">
          {initialCargo ? initialCargo.cssCcdNo : <>ID auto-generated on save (format <span className="font-mono">MCH/WH-00001</span>)</>}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Vessel Name" required>
          <input className="input" value={form.vesselName} onChange={(e) => set('vesselName', e.target.value)} required />
        </Field>
        <Field label="PKGS Type">
          <input className="input" value={form.pkgsType} onChange={(e) => set('pkgsType', e.target.value)} />
        </Field>

        <Field label="Date of Arrival">
          <input type="date" className="input" value={form.dateOfArrival} onChange={(e) => set('dateOfArrival', e.target.value)} />
        </Field>
        <Field label="No of PKGS">
          <input type="number" min={0} className="input" value={form.noOfPkgs} onChange={(e) => set('noOfPkgs', Number(e.target.value))} />
        </Field>

        <Field label="Type" required>
          <select
            className="input"
            value={cargoType}
            onChange={(e) => {
              const next = e.target.value as CargoType;
              setCargoType(next);
              if (next === 'GENERAL_CARGO') {
                set('containerNo', '');
                set('commodity', 'GENERAL CARGO');
                set('fclLcl', 'LCL');
                set('containerSize', 'NA');
              }
            }}
            required
          >
            <option value="CONTAINER">Container</option>
            <option value="GENERAL_CARGO">General Cargo</option>
          </select>
        </Field>
        {!isGeneralCargo && (
          <Field label="Container No" required>
            <input className="input" value={form.containerNo} onChange={(e) => set('containerNo', e.target.value)} required />
          </Field>
        )}
        {!isGeneralCargo && (
          <Field label="FCL / LCL">
            <select className="input" value={form.fclLcl} onChange={(e) => set('fclLcl', e.target.value as 'FCL' | 'LCL')}>
              <option value="LCL">LCL</option>
              <option value="FCL">FCL</option>
            </select>
          </Field>
        )}

        <Field label="Consignee Name" required>
          <input className="input" value={form.consigneeName} onChange={(e) => set('consigneeName', e.target.value)} required />
        </Field>
        {!isGeneralCargo && (
          <Field label="Container Size">
            <select className="input" value={form.containerSize} onChange={(e) => set('containerSize', e.target.value as 'FT20' | 'FT40' | 'NA')}>
              <option value="FT20">20 FT</option>
              <option value="FT40">40 FT</option>
              <option value="NA">N/A</option>
            </select>
          </Field>
        )}

        {isGeneralCargo && (
          <>
            <Field label="Mark">
              <input className="input" value={form.mark} onChange={(e) => set('mark', e.target.value)} />
            </Field>
            <Field label="Cargo Description">
              <input className="input" value={form.cargoDescription} onChange={(e) => set('cargoDescription', e.target.value)} />
            </Field>
            <Field label="Commodity" required>
              <input className="input" value={form.commodity} readOnly required />
            </Field>
          </>
        )}

        <Field label="Shifted Date" required>
          <input type="date" className="input" value={form.shiftedDate} onChange={(e) => set('shiftedDate', e.target.value)} required />
        </Field>
        <Field label="CBM">
          <input type="number" step="0.001" min={0} className="input" value={form.cbm} onChange={(e) => set('cbm', Number(e.target.value))} />
        </Field>

        <Field label="BL No" required>
          <input className="input" value={form.blNo} onChange={(e) => set('blNo', e.target.value)} required />
        </Field>
        <Field label="Detained Cargo Ref No">
          <input className="input" value={form.detainedCargoRefNo} onChange={(e) => set('detainedCargoRefNo', e.target.value)} />
        </Field>

        <Field label="Reason of Shifting">
          <input className="input" value={form.reasonOfShifting} onChange={(e) => set('reasonOfShifting', e.target.value)} />
        </Field>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.detainedByCustoms} onChange={(e) => set('detainedByCustoms', e.target.checked)} />
            Detained by Customs
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.detainedByHealth} onChange={(e) => set('detainedByHealth', e.target.checked)} />
            Detained by Health
          </label>
        </div>

        <Field label="Clearance Officer">
          <input className="input" value={form.clearanceOfficer} onChange={(e) => set('clearanceOfficer', e.target.value)} />
        </Field>
        <Field label="Employ ID">
          <input className="input" value={form.clearanceEmployId} onChange={(e) => set('clearanceEmployId', e.target.value)} />
        </Field>

        {showInitialSlot && (
          <Field label="Initial Rack Slot">
            <select className="input" value={form.currentSlotId} onChange={(e) => set('currentSlotId', e.target.value)}>
              <option value="">— assign later —</option>
              {activeSlots.map((s) => {
                const occupants = activeSlotOccupants(s);
                return (
                  <option key={s.id} value={s.id}>
                    {s.id}{occupants.length > 0 ? ` (${occupants.length} in slot)` : ''}
                  </option>
                );
              })}
            </select>
            {selectedOccupants.length > 0 && (
              <div className="mt-1 text-xs text-amber-700">
                This slot already contains {selectedOccupants.map((c) => c.label ?? cargoDisplayName(c.containerNo)).join(', ')}.
              </div>
            )}
          </Field>
        )}
        <Field label="Remarks">
          <input className="input" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary"
      >
        {submitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

function cargoDisplayName(containerNo: string) {
  return containerNo === 'VESSEL' ? 'General Cargo' : containerNo;
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
