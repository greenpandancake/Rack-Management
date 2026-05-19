import { useEffect, useRef, useState } from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function SearchBar({ value, onChange, placeholder }: Props) {
  const [local, setLocal] = useState(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChangeRef.current(local), 250);
    return () => clearTimeout(t);
  }, [local, value]);

  return (
    <input
      type="search"
      className="border border-slate-300 rounded-md px-3 py-2 text-sm w-full md:w-80 bg-white shadow-sm dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100 dark:placeholder-slate-400"
      placeholder={placeholder ?? 'Search container, BL, consignee…'}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
    />
  );
}
