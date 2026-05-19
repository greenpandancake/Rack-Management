export function cargoTypeLabel(containerNo: string) {
  return containerNo === 'VESSEL' ? 'General cargo' : 'Container';
}

export function shortDate(value: string) {
  return value ? value.slice(0, 10) : '-';
}

export function shortDateTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function titleCaseWords(value: string) {
  const formatted = value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\bPlc\b/g, 'PLC')
    .replace(/\bPvt\b/g, 'Pvt')
    .replace(/\bLtd\b/g, 'Ltd')
    .replace(/\bBl\b/g, 'BL')
    .replace(/\bPkgs\b/g, 'PKGS');
  return formatted;
}

export function companyName(value: string) {
  return titleCaseWords(value)
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bOf\b/g, 'of')
    .replace(/\bThe\b/g, 'the');
}
