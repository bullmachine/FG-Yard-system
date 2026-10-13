export function slotLabel(row: number, col: number): string {
  const letter = String.fromCharCode(64 + row);
  return `${letter}${col}`;
}

function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(iso?: string | null): string {
  const d = toDate(iso);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(iso?: string | null): string {
  const d = toDate(iso);
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDateShort(iso?: string | null): string {
  const d = toDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}