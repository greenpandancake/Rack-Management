import { VesselManifestRow } from '../api.js';
import type React from 'react';

export type VesselCargoRowFormValue = {
  manifestRef: string;
  consigneeName: string;
  mark: string;
  cargoDescription: string;
  pkgsType: string;
  noOfPkgs: number;
  remarks: string;
};

export const emptyVesselCargoRowForm: VesselCargoRowFormValue = {
  manifestRef: '',
  consigneeName: '',
  mark: '',
  cargoDescription: '',
  pkgsType: 'PKG',
  noOfPkgs: 0,
  remarks: '',
};

export function vesselCargoRowFormToManifestRow(form: VesselCargoRowFormValue): VesselManifestRow {
  return {
    manifestRef: form.manifestRef.trim(),
    consigneeName: form.consigneeName.trim(),
    mark: form.mark.trim(),
    commodity: 'GENERAL CARGO',
    cargoDescription: form.cargoDescription.trim(),
    pkgsType: form.pkgsType.trim() || 'PKG',
    noOfPkgs: Number(form.noOfPkgs) || 0,
    clearedQty: 0,
    remarks: form.remarks.trim(),
  };
}

export function VesselCargoRowForm({
  value,
  onChange,
}: {
  value: VesselCargoRowFormValue;
  onChange: (value: VesselCargoRowFormValue) => void;
}) {
  const set = <K extends keyof VesselCargoRowFormValue>(key: K, next: VesselCargoRowFormValue[K]) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="BL / Manifest Ref" required>
        <input className="input" value={value.manifestRef} onChange={(e) => set('manifestRef', e.target.value)} required />
      </Field>
      <Field label="Consignee" required>
        <input className="input" value={value.consigneeName} onChange={(e) => set('consigneeName', e.target.value)} required />
      </Field>
      <Field label="Mark">
        <input className="input" value={value.mark} onChange={(e) => set('mark', e.target.value)} />
      </Field>
      <Field label="Cargo Description" required>
        <input className="input" value={value.cargoDescription} onChange={(e) => set('cargoDescription', e.target.value)} required />
      </Field>
      <Field label="Package Type" required>
        <input className="input" value={value.pkgsType} onChange={(e) => set('pkgsType', e.target.value.toUpperCase())} required />
      </Field>
      <Field label="Quantity" required>
        <input
          type="number"
          min={0}
          className="input"
          value={value.noOfPkgs}
          onChange={(e) => set('noOfPkgs', Number(e.target.value))}
          required
        />
      </Field>
      <Field label="Remarks">
        <input className="input" value={value.remarks} onChange={(e) => set('remarks', e.target.value)} />
      </Field>
    </div>
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
