'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, ImagePlus, Lightbulb, MessageSquarePlus, MessageSquareText, Paperclip, RefreshCw, Search, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import PageHeader from '@/components/ui/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

type FeedbackType = 'SUGGESTION' | 'ISSUE' | 'OTHER';
type FeedbackStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'CLOSED';

interface FeedbackItem {
  id: string;
  type: FeedbackType;
  page: string | null;
  message: string;
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: string;
  handledAt: string | null;
  createdBy: { id: string; name: string; email: string; role: string };
  handledBy: { id: string; name: string } | null;
  screenshot: string | null;
}

/** Shrink a screenshot to at most 1600 px wide JPEG, so it uploads fast and stays under 2 MB. */
async function shrinkImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the image'))), 'image/jpeg', 0.82));
}

/** A feedback screenshot, fetched with the sign-in token (it is not a public file). Click opens it full size. */
function Screenshot({ id, className = '' }: { id: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let live = true;
    fetch(`${API_URL}/api/feedback/${id}/screenshot`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error())))
      .then((b) => { objectUrl = URL.createObjectURL(b); if (live) setUrl(objectUrl); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  if (failed) return <p className="text-[11px] text-slate-400">Screenshot not available</p>;
  if (!url) return <div className={`animate-pulse rounded-md bg-slate-100 ${className}`} />;
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Open full size" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset */}
      <img src={url} alt="Screenshot sent with the feedback" className={`rounded-md border border-slate-200 object-contain object-left-top bg-slate-50 ${className}`} />
    </a>
  );
}

const TYPES: { value: FeedbackType; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: 'SUGGESTION', label: 'Suggestion', hint: 'An idea to make it better', icon: <Lightbulb className="w-4 h-4" /> },
  { value: 'ISSUE', label: 'Issue', hint: 'Something is wrong or not working', icon: <Bug className="w-4 h-4" /> },
  { value: 'OTHER', label: 'Other', hint: 'Any other feedback', icon: <MessageSquareText className="w-4 h-4" /> },
];

const TYPE_META: Record<FeedbackType, { label: string; variant: 'blue' | 'red' | 'gray' }> = {
  SUGGESTION: { label: 'Suggestion', variant: 'blue' },
  ISSUE: { label: 'Issue', variant: 'red' },
  OTHER: { label: 'Other', variant: 'gray' },
};

const STATUS_META: Record<FeedbackStatus, { label: string; variant: 'amber' | 'blue' | 'green' | 'gray' }> = {
  NEW: { label: 'New', variant: 'amber' },
  IN_PROGRESS: { label: 'In progress', variant: 'blue' },
  DONE: { label: 'Done', variant: 'green' },
  CLOSED: { label: 'Closed', variant: 'gray' },
};

/**
 * Top-bar button: any signed-in user sends a suggestion, issue or other feedback, and
 * sees their earlier ones with the Admin's status and reply. The current page is sent
 * along so the Admin knows where it came from.
 */
export function FeedbackButton({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'send' | 'mine'>('send');
  const [type, setType] = useState<FeedbackType>('SUGGESTION');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<FeedbackItem[] | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const clearShot = () => setShot((s) => { if (s) URL.revokeObjectURL(s.url); return null; });

  const attach = async (file: Blob | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setError(null);
    try {
      const blob = await shrinkImage(file);
      clearShot();
      setShot({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setError('Could not read that image. Try a PNG or JPG.');
    }
  };

  // Print Screen, then Ctrl+V anywhere in the form attaches the screenshot.
  const onPaste = (e: React.ClipboardEvent) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); void attach(item.getAsFile()); }
  };

  const loadMine = useCallback(() => {
    setMine(null);
    fetch(`${API_URL}/api/feedback/mine`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMine(Array.isArray(d) ? d : []))
      .catch(() => setMine([]));
  }, []);

  const openForm = () => {
    setOpen(true);
    setTab('send');
    setError(null);
    setSent(false);
  };

  const showMine = () => { setTab('mine'); loadMine(); };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      let body: BodyInit;
      const headers: Record<string, string> = authHeaders();
      if (shot) {
        const form = new FormData();
        form.append('type', type);
        form.append('message', message);
        form.append('page', page);
        form.append('screenshot', shot.blob, 'screenshot.jpg');
        body = form;
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({ type, message, page });
      }
      const r = await fetch(`${API_URL}/api/feedback`, { method: 'POST', headers, body });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setError(d?.error || `Could not send (${r.status})`); return; }
      setMessage('');
      clearShot();
      setSent(true);
    } catch {
      setError('Connection error - try again');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openForm}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        title="Send a suggestion, report an issue or give feedback"
      >
        <MessageSquarePlus className="w-4 h-4 text-blue-600" />
        <span className="hidden sm:inline">Feedback</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Feedback"
        subtitle="Suggestions, issues or anything that would make FG Yard better"
        size="md"
        footer={tab === 'send' && !sent ? (
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={send} loading={sending} disabled={message.trim().length < 5}>Send</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
        )}
      >
        <div className="mb-3 flex gap-1.5">
          {([['send', 'Send feedback'], ['mine', 'My feedback']] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => (v === 'mine' ? showMine() : (setTab('send'), setSent(false)))}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${tab === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {l}
            </button>
          ))}
        </div>

        {tab === 'send' && (sent ? (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
            <p className="font-semibold">Thank you. Your feedback has been sent.</p>
            <p className="text-xs">The Administrator will review it. You can follow its status and reply under My feedback.</p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="secondary" onClick={() => setSent(false)}>Send another</Button>
              <Button size="sm" variant="ghost" onClick={showMine}>My feedback</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" onPaste={onPaste}>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Type">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={type === t.value}
                  onClick={() => setType(t.value)}
                  className={`rounded-lg border px-2 py-2 text-left transition-colors ${type === t.value ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <span className={`flex items-center gap-1.5 text-xs font-semibold ${type === t.value ? 'text-blue-800' : 'text-slate-800'}`}>{t.icon}{t.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-slate-500">{t.hint}</span>
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <label htmlFor="feedback-message" className="block text-xs font-medium text-slate-700">
                {type === 'ISSUE' ? 'What happened? Which machine or step, if any?' : 'Your feedback'}
              </label>
              <textarea
                id="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                maxLength={4000}
                placeholder={type === 'ISSUE' ? 'e.g. Gate scan shows "machine not found" for serial HH4547' : 'e.g. Show the driver phone number on the dispatch list'}
                className="w-full px-3 py-2 text-base sm:text-[13px] border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-slate-400 resize-y"
              />
              <p className="text-[11px] text-slate-500">Sent from: {page}. Your name and the time are included.</p>
            </div>
            <div>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
              {shot ? (
                <div className="flex items-start gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
                  <img src={shot.url} alt="Screenshot to send" className="h-20 max-w-[60%] rounded-md border border-slate-200 object-contain bg-slate-50" />
                  <Button size="sm" variant="ghost" onClick={clearShot} icon={<X className="w-3.5 h-3.5" />}>Remove</Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-600 hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
                >
                  <ImagePlus className="h-4 w-4 text-blue-600" />
                  <span>Add a screenshot (optional) <span className="text-slate-400">· or press Ctrl+V to paste one</span></span>
                </button>
              )}
            </div>
            {error && <p className="text-xs font-medium text-red-700">{error}</p>}
          </div>
        ))}

        {tab === 'mine' && (
          mine === null ? <p className="py-6 text-center text-xs text-slate-500">Loading…</p>
            : mine.length === 0 ? <EmptyState title="Nothing sent yet" description="Your suggestions and issues appear here with their status" />
              : (
                <ul className="space-y-2">
                  {mine.map((f) => (
                    <li key={f.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={TYPE_META[f.type].variant}>{TYPE_META[f.type].label}</Badge>
                        <Badge variant={STATUS_META[f.status].variant}>{STATUS_META[f.status].label}</Badge>
                        <span className="text-[11px] text-slate-400">{formatDateTime(f.createdAt)}{f.page ? ` · ${f.page}` : ''}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-800">{f.message}</p>
                      {f.screenshot && <div className="mt-1.5"><Screenshot id={f.id} className="h-24 max-w-full" /></div>}
                      {f.adminNote && (
                        <p className="mt-1.5 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                          <span className="font-semibold">Reply{f.handledBy ? ` from ${f.handledBy.name}` : ''}:</span> {f.adminNote}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )
        )}
      </Modal>
    </>
  );
}

/** Administration > Feedback: everything users sent, with status and a reply to the sender. */
export default function FeedbackAdmin() {
  const [data, setData] = useState<{ items: FeedbackItem[]; total: number; counts: Record<FeedbackStatus, number> } | null>(null);
  const [status, setStatus] = useState<FeedbackStatus | ''>('NEW');
  const [type, setType] = useState<FeedbackType | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [editStatus, setEditStatus] = useState<FeedbackStatus>('NEW');
  const [editNote, setEditNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const next = search.trim();
    if (next === query) return;
    const t = setTimeout(() => { setQuery(next); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search, query]);

  const load = useCallback((isCurrent: () => boolean = () => true) => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) qs.set('status', status);
    if (type) qs.set('type', type);
    if (query) qs.set('q', query);
    return fetch(`${API_URL}/api/feedback?${qs}`, { headers: authHeaders() })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error || `Load failed (${r.status})`);
        if (isCurrent()) { setData(d); setError(null); }
      })
      .catch((e: Error) => { if (isCurrent()) setError(e.message); })
      .finally(() => { if (isCurrent()) setLoading(false); });
  }, [page, pageSize, status, type, query]);

  useEffect(() => {
    let current = true;
    load(() => current);
    return () => { current = false; };
  }, [load]);

  const openItem = (f: FeedbackItem) => {
    setSelected(f);
    setEditStatus(f.status === 'NEW' ? 'IN_PROGRESS' : f.status);
    setEditNote(f.adminNote ?? '');
    setSaveError(null);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch(`${API_URL}/api/feedback/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: editStatus, adminNote: editNote }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setSaveError(d?.error || `Save failed (${r.status})`); return; }
      setSelected(null);
      await load();
    } catch {
      setSaveError('Connection error - try again');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSpinner />;

  const counts = data?.counts;
  const statusTabs: { value: FeedbackStatus | ''; label: string }[] = [
    { value: 'NEW', label: 'New' },
    { value: 'IN_PROGRESS', label: 'In progress' },
    { value: 'DONE', label: 'Done' },
    { value: 'CLOSED', label: 'Closed' },
    { value: '', label: 'All' },
  ];
  const allCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Feedback"
        description="Suggestions and issues sent by users from the Feedback button"
        actions={<Button variant="ghost" onClick={() => load()} icon={<RefreshCw className="w-4 h-4" />}>Refresh</Button>}
      />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}

      <div className="bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {statusTabs.map((t) => {
              const n = t.value ? counts?.[t.value] ?? 0 : allCount;
              const active = status === t.value;
              return (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => { setStatus(t.value); setPage(1); }}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${active ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:opacity-80'}`}
                >
                  {t.label}
                  <span className={`text-[10px] tabular-nums ${active ? 'text-white/70' : ''}`}>{n}</span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex w-full flex-wrap gap-1.5 sm:w-auto">
            <Select
              value={type}
              onChange={(e) => { setType(e.target.value as FeedbackType | ''); setPage(1); }}
              options={[{ value: '', label: 'All types' }, ...TYPES.map((t) => ({ value: t.value, label: t.label }))]}
              className="w-full sm:w-36"
              aria-label="Filter by type"
            />
            <div className="w-full sm:w-56">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Text, page or name…" icon={<Search className="w-3.5 h-3.5" />} aria-label="Search feedback" />
            </div>
          </div>
        </div>

        {!data || data.items.length === 0 ? (
          <EmptyState icon={<MessageSquareText className="w-6 h-6 text-slate-400" />} title="No feedback here" description="Feedback appears here when a user sends it" />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => openItem(f)} className="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={TYPE_META[f.type].variant}>{TYPE_META[f.type].label}</Badge>
                      <Badge variant={STATUS_META[f.status].variant}>{STATUS_META[f.status].label}</Badge>
                      <span className="text-xs font-medium text-slate-800">{f.createdBy.name}</span>
                      <span className="text-[11px] text-slate-400">{formatDateTime(f.createdAt)}{f.page ? ` · ${f.page}` : ''}</span>
                      {f.screenshot && <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-500" title="Has a screenshot"><Paperclip className="h-3 w-3" />Screenshot</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] text-slate-700">{f.message}</p>
                    {f.adminNote && <p className="mt-0.5 truncate text-[11px] text-slate-500">Reply: {f.adminNote}</p>}
                  </button>
                </li>
              ))}
            </ul>
            <Pagination total={data.total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} pageSizes={[25, 50, 100]} />
          </>
        )}
      </div>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${TYPE_META[selected.type].label} from ${selected.createdBy.name}` : undefined}
        subtitle={selected ? `${selected.createdBy.email} · ${formatDateTime(selected.createdAt)}${selected.page ? ` · ${selected.page}` : ''}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={save} loading={saving}>Save</Button>
          </>
        }
      >
        {selected && (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800">{selected.message}</p>
            {selected.screenshot && <Screenshot id={selected.id} className="max-h-64 w-full" />}
            <Select
              label="Status"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as FeedbackStatus)}
              options={(Object.keys(STATUS_META) as FeedbackStatus[]).map((s) => ({ value: s, label: STATUS_META[s].label }))}
            />
            <div className="space-y-1">
              <label htmlFor="feedback-reply" className="block text-xs font-medium text-slate-700">Reply to {selected.createdBy.name} (optional)</label>
              <textarea
                id="feedback-reply"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="e.g. Fixed in the 30 Oct update"
                className="w-full px-3 py-2 text-[13px] border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none placeholder:text-slate-400 resize-y"
              />
              <p className="text-[11px] text-slate-500">The sender is notified when the status or the reply changes, and sees it under Feedback › My feedback.</p>
            </div>
            {selected.handledBy && selected.handledAt && (
              <p className="text-[11px] text-slate-500">Last updated by {selected.handledBy.name}, {formatDateTime(selected.handledAt)}</p>
            )}
            {saveError && <p className="text-xs font-medium text-red-700">{saveError}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
