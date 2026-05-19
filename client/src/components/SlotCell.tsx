import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Slot } from '../api.js';
import { companyName } from '../format.js';

type Props = { slot: Slot };

type Occupant = {
  id: string;
  cargoId: string;
  containerNo: string;
  blNo: string;
  consigneeName: string;
  isOverdue: boolean;
  status: Slot['cargos'][number]['status'];
  label?: string;
  quantity?: number;
  pkgsType?: string;
};

export function activeSlotOccupants(slot: Slot): Occupant[] {
  const cargos = slot.cargos
    .filter((c) => c.status === 'IN_RACK' || c.status === 'CHECKED_FOR_AUCTION' || c.status === 'MARKED_FOR_DISPOSAL')
    .map((c) => ({ ...c, cargoId: c.id }));
  const portions = slot.portions
    .filter((p) => p.status === 'IN_RACK' || p.status === 'CHECKED_FOR_AUCTION' || p.status === 'MARKED_FOR_DISPOSAL')
    .map((p) => ({
      id: p.id,
      cargoId: p.cargo.id,
      containerNo: p.cargo.containerNo,
      blNo: p.cargo.blNo,
      consigneeName: p.cargo.consigneeName,
      isOverdue: p.cargo.isOverdue,
      status: p.status,
      label: p.label,
      quantity: p.quantity,
      pkgsType: p.pkgsType,
    }));
  return [...cargos, ...portions];
}

function statusColour(occupants: Occupant[]) {
  const hasDisposal = occupants.some((c) => c.status === 'MARKED_FOR_DISPOSAL');
  const hasAuction = occupants.some((c) => c.status === 'CHECKED_FOR_AUCTION');
  const hasOverdue = occupants.some((c) => c.isOverdue);
  if (hasDisposal) return 'bg-orange-500 text-white border-orange-600 hover:bg-orange-600';
  if (hasAuction) return 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600';
  if (hasOverdue) return 'bg-red-500 text-white border-red-600 hover:bg-red-600';
  return 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700';
}

function occupantLabel(occupant: Occupant) {
  return occupant.label ?? (occupant.containerNo === 'VESSEL' ? 'General Cargo' : occupant.containerNo);
}

export function SlotCell({ slot }: Props) {
  const occupants = activeSlotOccupants(slot);

  if (!slot.isActive) {
    return (
      <div className="min-h-16 rounded-md border border-dashed border-slate-300 bg-white/60 text-slate-400 text-xs px-2 py-2 text-center">
        <div className="font-semibold">{slot.id}</div>
        <div>disabled</div>
      </div>
    );
  }

  if (occupants.length === 0) {
    return (
      <div className="min-h-16 rounded-md border border-slate-200 bg-white text-slate-500 text-xs px-2 py-2 text-center shadow-sm hover:border-sky-300 hover:bg-sky-50 transition">
        <div className="font-semibold">{slot.id}</div>
        <div className="text-slate-400">empty</div>
      </div>
    );
  }

  if (occupants.length === 1) {
    const occupant = occupants[0];
    const auction = occupant.status === 'CHECKED_FOR_AUCTION';
    const disposal = occupant.status === 'MARKED_FOR_DISPOSAL';
    return (
      <Link
        to={`/cargo/${occupant.cargoId}`}
        className={`block min-h-16 rounded-md text-xs px-2 py-2 text-center border shadow-sm transition ${statusColour(occupants)}`}
        title={`${occupantLabel(occupant)} - ${companyName(occupant.consigneeName)}${auction ? ' - AUCTION' : ''}${disposal ? ' - DISPOSAL' : ''}`}
      >
        <div className="font-semibold">{slot.id}</div>
        <div className="truncate">{occupantLabel(occupant)}</div>
        {occupant.quantity != null && <div className="text-[10px]">{occupant.quantity} x {occupant.pkgsType}</div>}
        {auction && <div className="text-[10px] font-semibold tracking-wide">AUCTION</div>}
        {disposal && <div className="text-[10px] font-semibold tracking-wide">DISPOSAL</div>}
      </Link>
    );
  }

  return <MultiOccupantCell slot={slot} occupants={occupants} />;
}

function MultiOccupantCell({ slot, occupants }: { slot: Slot; occupants: Occupant[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const colour = statusColour(occupants);
  const hasAuction = occupants.some((c) => c.status === 'CHECKED_FOR_AUCTION');
  const hasDisposal = occupants.some((c) => c.status === 'MARKED_FOR_DISPOSAL');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`w-full min-h-16 rounded-md text-xs px-2 py-2 text-center border shadow-sm transition cursor-pointer ${colour}`}
        title={`${occupants.length} cargos in ${slot.id} - click to view all`}
      >
        <div className="font-semibold">{slot.id}</div>
        <div className="truncate">{occupantLabel(occupants[0])}</div>
        <div className="text-[10px] font-semibold">+{occupants.length - 1} more</div>
        {hasAuction && <div className="text-[10px] font-semibold tracking-wide">AUCTION</div>}
        {hasDisposal && <div className="text-[10px] font-semibold tracking-wide">DISPOSAL</div>}
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute z-20 left-1/2 -translate-x-1/2 mt-1 w-64 max-w-[calc(100vw-1rem)] rounded-md border border-slate-200 bg-white shadow-lg text-left text-xs"
        >
          <div className="px-3 py-2 border-b border-slate-100 text-slate-500 font-semibold">
            {occupants.length} cargos in {slot.id}
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {occupants.map((c) => {
              const auction = c.status === 'CHECKED_FOR_AUCTION';
              const disposal = c.status === 'MARKED_FOR_DISPOSAL';
              const dot = disposal
                ? 'bg-orange-500'
                : auction
                  ? 'bg-amber-500'
                  : c.isOverdue
                    ? 'bg-red-500'
                    : 'bg-emerald-600';
              return (
                <li key={c.id}>
                  <Link
                    to={`/cargo/${c.cargoId}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2 px-3 py-2 hover:bg-sky-50 transition"
                  >
                    <span className={`mt-1 inline-block h-2 w-2 rounded-full ${dot} shrink-0`} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-900 truncate">{occupantLabel(c)}</span>
                      <span className="block text-slate-500 truncate">{companyName(c.consigneeName)}</span>
                      <span className="block text-[10px] text-slate-400">
                        BL {c.blNo}
                        {c.quantity != null && ` · ${c.quantity} x ${c.pkgsType}`}
                        {auction && ' · AUCTION'}
                        {disposal && ' · DISPOSAL'}
                        {c.isOverdue && ' · OVERDUE'}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
