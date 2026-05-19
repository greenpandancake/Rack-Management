import { useMemo } from 'react';
import { Slot } from '../api.js';
import { SlotCell } from './SlotCell.js';

type Props = { slots: Slot[] };

export function RackGrid({ slots }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, Map<number, Slot[]>>();
    for (const s of slots) {
      if (!map.has(s.row)) map.set(s.row, new Map());
      const lvlMap = map.get(s.row)!;
      if (!lvlMap.has(s.level)) lvlMap.set(s.level, []);
      lvlMap.get(s.level)!.push(s);
    }
    for (const lvlMap of map.values()) {
      for (const arr of lvlMap.values()) arr.sort((a, b) => a.slot - b.slot);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  if (slots.length === 0) {
    return <div className="app-panel p-6 text-slate-500 text-sm">No rack slots configured yet - visit Settings.</div>;
  }

  return (
    <div className="space-y-6">
      {grouped.map(([row, lvlMap]) => {
        const levels = [...lvlMap.keys()].sort((a, b) => b - a);
        const slotsPerLevel = Math.max(...[...lvlMap.values()].map((a) => a.length));
        return (
          <div key={row} className="app-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold text-sm">Row {row}</div>
              <div className="text-xs text-slate-500">{levels.length} levels · {slotsPerLevel} slots/level</div>
            </div>
            <div className="space-y-2 rounded-md bg-slate-50 border border-slate-200 p-3 dark:bg-slate-900 dark:border-slate-700">
              {levels.map((lvl) => (
                <div key={lvl} className="flex items-center gap-2">
                  <div className="w-12 text-xs font-semibold text-slate-500 text-right">L{lvl}</div>
                  <div
                    className="grid gap-1 flex-1"
                    style={{ gridTemplateColumns: `repeat(${slotsPerLevel}, minmax(0, 1fr))` }}
                  >
                    {(lvlMap.get(lvl) ?? []).map((s) => (
                      <SlotCell key={s.id} slot={s} />
                    ))}
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

