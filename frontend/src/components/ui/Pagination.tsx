'use client';

interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
  compact?: boolean;
}

export default function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 15, 30, 50],
  compact = false,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className={`flex items-center justify-between flex-wrap gap-2 border-t border-slate-200 ${compact ? 'px-3 py-2' : 'px-4 py-2.5'}`}>
      <div className="flex items-center gap-2 min-w-0">
        <p className="text-xs text-slate-500 tabular-nums">
          <span className="font-medium text-slate-700">{total}</span> {total === 1 ? 'item' : 'items'}
          {total > 0 && <span className="hidden sm:inline"> · {start}–{end}{totalPages > 1 ? ` of ${totalPages} pages` : ''}</span>}
        </p>
        {!compact && onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="text-xs border border-slate-300 rounded-md px-1.5 py-1 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            aria-label="Rows per page"
          >
            {pageSizes.map(s => <option key={s} value={s}>{s} / page</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Prev
        </button>
        <span className="text-xs text-slate-500 tabular-nums px-1">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}