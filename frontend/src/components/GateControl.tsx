'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

// Browser-only gate for the portaled print pass: getServerSnapshot keeps SSR and
// hydration markup identical (no portal), the client snapshot flips it on right
// after hydration - without a setState inside an effect, which the lint rejects.
const subscribeEmpty = () => () => {};
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { SectionCard } from '@/components/ui/Card';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import BarcodeCameraModal from '@/components/BarcodeCameraModal';
import { PageSpinner } from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { slotLabel, formatDateTime } from '@/lib/format';
import { Barcode as BarcodeSvg, canEncodeCode128 } from '@/lib/barcode';
import { renderGateLabel } from '@/lib/gateLabel';
import { Shield, CheckCircle2, XCircle, ScanLine, UserRound, DoorOpen, DoorClosed, MapPin, RotateCcw, ArrowRight, ChevronDown, ChevronUp, Printer, Download, Camera } from 'lucide-react';

interface Driver { id: string; name: string; employeeCode?: string | null; photoUrl?: string | null; }
interface SlotRef { row: number; col: number; status?: string; yard?: { name: string } | null; }
interface Machine {
  id: string;
  serialNumber: string;
  barcode?: string;
  assemblyStage: number;
  parkStatus: string;
  // Where the machine is headed. currentSlot is null while it is still
  // READY_TO_MOVE, so plannedSlot is the one that matters at the gate.
  currentSlot?: SlotRef | null;
  plannedSlot?: SlotRef | null;
}
interface GateLog { id: string; machine: { serialNumber: string }; driver: { name: string }; authMethod: string; barcode: string; result: string; direction?: string; barrierOpenedAt?: string; barrierClosedAt?: string; createdAt: string; }

interface AuthResult {
  result: 'AUTHORIZED' | 'REJECTED';
  gateLogId?: string;
  barrier?: 'OPEN' | 'CLOSED';
  direction?: string;
  reason?: string;
  driver?: { id: string; name: string; employeeCode?: string | null; photoUrl?: string | null };
  machine?: {
    id: string;
    serialNumber: string;
    model?: string | null;
    assemblyStage: number;
    parkStatus: string;
    assignedSlot?: { id: string; row: number; col: number; status: string; yard?: { name: string } };
  };
}

type DetectionState = 'none' | 'detecting' | 'ok' | 'notready' | 'missing';

interface BarrierConfig {
  openUrl: string;
  closeUrl: string;
  autoCloseSeconds: number;
  manualOpenEnabled: boolean;
}

const EMPTY_BARRIER: BarrierConfig = { openUrl: '', closeUrl: '', autoCloseSeconds: 0, manualOpenEnabled: false };

export default function GateControl({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [logs, setLogs] = useState<GateLog[]>([]);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [barrierConfig, setBarrierConfig] = useState<BarrierConfig>(EMPTY_BARRIER);
  const [driverBarcodeInput, setDriverBarcodeInput] = useState('');
  const [driverScan, setDriverScan] = useState<{ state: 'none' | 'ok' | 'missing'; driver?: Driver }>({ state: 'none' });
  const [selectedMachine, setSelectedMachine] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scannerTarget, setScannerTarget] = useState<'driver' | 'machine' | null>(null);
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [detection, setDetection] = useState<{ state: DetectionState; machine?: Machine }>({ state: 'none' });
  const [authResult, setAuthResult] = useState<AuthResult | null>(null);
  const [issuedAt, setIssuedAt] = useState('');
  const [labelPng, setLabelPng] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [closing, setClosing] = useState(false);
  // The print pass is portaled to document.body (see #gate-pass below).
  const mounted = useSyncExternalStore(subscribeEmpty, () => true, () => false);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  const detectSeq = useRef(0);
  const driverSeq = useRef(0);
  const barrierTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const headers = () => { const h: Record<string, string> = {}; const t = localStorage.getItem('token'); if (t) h['Authorization'] = `Bearer ${t}`; return h; };

  // The boom barrier controller lives on this screen's Wi-Fi, so the tab fires the
  // configured URL as a plain GET. An Image() ping needs no CORS headers from the
  // controller and works even for a bare relay that returns nothing.
  const fireBarrier = (url: string) => {
    if (!url || !url.trim()) return;
    new Image().src = url;
  };

  const clearBarrierTimer = () => {
    if (barrierTimer.current) {
      clearTimeout(barrierTimer.current);
      barrierTimer.current = null;
    }
  };

  const fetchData = async () => {
    try {
      const [dRes, mRes] = await Promise.all([fetch(`${API_URL}/api/drivers`, { headers: headers() }), fetch(`${API_URL}/api/machines`, { headers: headers() })]);
      setDrivers(await dRes.json());
      const all = await mRes.json();
      setMachines(all.filter((m: Machine) => m.assemblyStage >= 18 && m.barcode && m.barcode.trim() !== ''));
      try { const lRes = await fetch(`${API_URL}/api/gate/logs`, { headers: headers() }); if (lRes.ok) setLogs(await lRes.json()); } catch { }
      try { const bRes = await fetch(`${API_URL}/api/gate/barrier/config`, { headers: headers() }); if (bRes.ok) setBarrierConfig(await bRes.json()); } catch { }
    } catch { } finally { setLoading(false); }
  };
  useEffect(() => { fetchData(); return () => clearBarrierTimer(); }, []);

  // Live detection: debounce the scan, look the machine up by barcode, and
  // auto-select it so Authenticate sends a matching machineId + barcode.
  useEffect(() => {
    const code = barcodeInput.trim();
    const seq = ++detectSeq.current;

    if (!code) {
      setDetection({ state: 'none' });
      setSelectedMachine(prev => (detection.machine?.id === prev ? '' : prev));
      return;
    }

    setDetection({ state: 'detecting' });
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/api/machines?search=${encodeURIComponent(code)}`, { headers: headers() });
        if (!r.ok) {
          if (detectSeq.current === seq) setDetection({ state: 'missing' });
          return;
        }
        const list: Machine[] = await r.json();
        const match = (Array.isArray(list) ? list : []).find(m => m.barcode && m.barcode.trim().toLowerCase() === code.toLowerCase());
        if (detectSeq.current !== seq) return;
        if (!match) {
          setDetection({ state: 'missing' });
          return;
        }
        // Eligibility differs per direction: coming IN the machine only needs to be
        // stage 18+; leaving OUT it must already be released (AT_GATE).
        const eligible = direction === 'OUT' ? match.parkStatus === 'AT_GATE' : match.assemblyStage >= 18;
        if (eligible) {
          setSelectedMachine(match.id);
          setDetection({ state: 'ok', machine: match });
        } else {
          setDetection({ state: 'notready', machine: match });
        }
      } catch {
        if (detectSeq.current === seq) setDetection({ state: 'missing' });
      }
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcodeInput, direction]);

  // Driver badge detection: same pattern as the machine barcode above, but the
  // roster is already in memory (the gate screen loads it once), so the lookup is
  // local and exact - a badge must match the whole code, not just contain it.
  useEffect(() => {
    const code = driverBarcodeInput.trim();
    const seq = ++driverSeq.current;

    const timer = setTimeout(() => {
      if (driverSeq.current !== seq) return;
      if (!code) {
        setDriverScan({ state: 'none' });
        return;
      }
      const match = drivers.find(d => d.employeeCode && d.employeeCode.trim().toLowerCase() === code.toLowerCase());
      setDriverScan(match ? { state: 'ok', driver: match } : { state: 'missing' });
    }, 400);

    return () => clearTimeout(timer);
  }, [driverBarcodeInput, drivers]);

  const handleAuthenticate = async () => {
    if (driverScan.state !== 'ok' || (!selectedMachine && !barcodeInput)) return;
    setAuthenticating(true);
    setAuthResult(null);
    clearBarrierTimer();
    try {
      const r = await fetch(`${API_URL}/api/gate/authenticate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ driverBarcode: driverBarcodeInput, machineId: selectedMachine, barcode: barcodeInput, direction }) });
      const data = await r.json();
      setAuthResult(data);
      // Freeze the pass timestamp at authorization so the printed "Issued" does
      // not shift on every re-render (barrier close, log refresh, ...).
      setIssuedAt(data.result === 'AUTHORIZED' ? new Date().toISOString() : '');
      if (data.result === 'AUTHORIZED' && data.barrier === 'OPEN') {
        // Open the physical barrier from the tab, then schedule the auto-close
        // so a busy operator never leaves the gate standing open.
        fireBarrier(barrierConfig.openUrl);
        if (barrierConfig.autoCloseSeconds > 0) {
          barrierTimer.current = setTimeout(() => { handleCloseBarrier(); }, barrierConfig.autoCloseSeconds * 1000);
        }
      }
      fetchData();
    } catch { setAuthResult({ result: 'REJECTED', reason: 'Connection error' }); } finally { setAuthenticating(false); }
  };

  const handleManualOpen = () => {
    clearBarrierTimer();
    fireBarrier(barrierConfig.openUrl);
    // A manual open is a physical-only override: no driver log is created, but the
    // same auto-close applies so the gate does not stand open when unused.
    if (barrierConfig.autoCloseSeconds > 0) {
      barrierTimer.current = setTimeout(() => { handleCloseBarrier(); }, barrierConfig.autoCloseSeconds * 1000);
    }
  };

  const handleCloseBarrier = async () => {
    clearBarrierTimer();
    // Lower the physical barrier from the tab regardless of the server's state.
    fireBarrier(barrierConfig.closeUrl);
    if (!authResult?.gateLogId) return;
    setClosing(true);
    try {
      const r = await fetch(`${API_URL}/api/gate/barrier/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers() }, body: JSON.stringify({ gateLogId: authResult.gateLogId }) });
      const data = await r.json();
      if (data.barrier === 'CLOSED') setAuthResult(a => (a ? { ...a, barrier: 'CLOSED' } : a));
      fetchData();
    } catch { } finally { setClosing(false); }
  };

  const handleReset = () => {
    clearBarrierTimer();
    setDriverBarcodeInput('');
    setDriverScan({ state: 'none' });
    setSelectedMachine('');
    setBarcodeInput('');
    setScannerTarget(null);
    setShowManualPicker(false);
    setDetection({ state: 'none' });
    setAuthResult(null);
    setIssuedAt('');
  };

  const setGateDirection = (d: 'IN' | 'OUT') => {
    if (d === direction) return;
    // A fresh flow: clear any in-progress scan and result so nothing from the
    // other direction remains on screen.
    handleReset();
    setDirection(d);
  };

  const stepIcon = (done: boolean, icon: React.ReactNode) => (
    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
      <span className="text-[10px] font-bold">{icon}</span>
    </div>
  );

  // Trailing camera button: fills the field from a live barcode scan, exactly as
  // a hardware scanner would, so all the existing detection/validation still runs.
  const cameraSuffix = (target: 'driver' | 'machine', label: string) => (
    <button
      type="button"
      onClick={() => setScannerTarget(target)}
      title={`Scan ${label} with camera`}
      aria-label={`Scan ${label} with camera`}
      className="flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors"
    >
      <Camera className="w-4 h-4" />
    </button>
  );

  const authorized = authResult?.result === 'AUTHORIZED';
  const barrierOpen = authResult?.barrier === 'OPEN';
  const slot = authResult?.machine?.assignedSlot;
  // The pass carries the driver's badge as a scannable Code 128 symbol. Guarded so
  // a driver with no badge (or an unencodable code) just gets no symbol rather than
  // a blank/broken print.
  const passBadge = authResult?.driver?.employeeCode ?? '';
  const showPassBarcode = passBadge !== '' && canEncodeCode128(passBadge);

  // Builds the 50mm OpenLabel PNG in the click handler (canvas + photo loading
  // never touches render), so no setState-in-effect lint trips either.
  const openLabel = async () => {
    if (!authResult?.driver) return;
    const png = await renderGateLabel({
      title: direction === 'IN' ? 'Gate Entry Pass' : 'Gate Exit Authorization',
      issued: issuedAt ? formatDateTime(issuedAt) : formatDateTime(new Date().toISOString()),
      ref: authResult.gateLogId?.slice(0, 8) ?? '—',
      driverName: authResult.driver.name ?? '',
      badgeCode: showPassBarcode ? passBadge : '',
      photoUrl: authResult.driver.photoUrl ? `${API_URL}${authResult.driver.photoUrl}` : '',
      vehicle: `${authResult.machine?.serialNumber ?? ''}${authResult.machine?.model ? ` · ${authResult.machine.model}` : ''} · STAGE ${authResult.machine?.assemblyStage ?? '—'}`,
      detailCaption: direction === 'IN' ? 'Assigned slot' : 'Direction',
      detailYard: direction === 'IN' ? `${slot?.yard?.name ?? ''}` : '',
      detailValue: direction === 'IN'
        ? (slot ? slotLabel(slot.row, slot.col) : '—')
        : 'OUT · Machine left the yard',
      footnote: direction === 'IN'
        ? 'Present this pass at security with your ID.'
        : 'Machine recorded as EXITED. Exit request completed.',
    });
    setLabelPng(png);
  };

  const downloadLabel = () => {
    if (!labelPng) return;
    const a = document.createElement('a');
    a.href = labelPng;
    a.download = `gate-${direction === 'IN' ? 'entry' : 'exit'}-${authResult?.gateLogId?.slice(0, 8) ?? 'pass'}.png`;
    a.click();
  };
  const screenMachines = direction === 'IN'
    // A machine that left the yard counts as inward-eligible again only once a
    // return slot has been reserved for it, so it does not surface here by mistake.
    ? machines.filter(m => m.parkStatus !== 'PARKED_VERIFIED' && (m.parkStatus !== 'EXITED' || m.plannedSlot?.status === 'RESERVED'))
    : machines.filter(m => m.parkStatus === 'AT_GATE');
  const pickedLabel = screenMachines.find(m => m.id === selectedMachine);

  if (loading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gate Control"
        description={direction === 'IN' ? 'Authenticate drivers and machines entering the yard' : 'Verify released machines leaving the yard'}
        actions={
          <div className="flex rounded-lg border border-slate-300 bg-white overflow-hidden text-xs font-medium">
            <button
              type="button"
              onClick={() => setGateDirection('IN')}
              className={`px-3 py-1.5 transition-colors ${direction === 'IN' ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              Inward
            </button>
            <button
              type="button"
              onClick={() => setGateDirection('OUT')}
              className={`px-3 py-1.5 transition-colors ${direction === 'OUT' ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              Outward
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Auth Panel */}
        <div className="lg:col-span-2">
          <SectionCard
            title={direction === 'IN' ? 'Gate Entry Authentication' : 'Gate Exit Authentication'}
            description={direction === 'IN' ? 'Scan the driver and the machine barcode to authenticate' : 'Scan the driver badge and the released machine barcode'}
          >
            {/* 3-Step Visual */}
            {/* Wraps on phones; the connector lines only show when the steps fit on one row. */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${driverScan.state === 'ok' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                {stepIcon(driverScan.state === 'ok', <UserRound className="w-2.5 h-2.5" />)}
                <span className="text-xs font-medium text-slate-700">Scan Driver</span>
              </div>
              <div className="hidden sm:block h-px flex-1 bg-slate-200" />
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${pickedLabel ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                {stepIcon(!!pickedLabel, <ScanLine className="w-2.5 h-2.5" />)}
                <span className="text-xs font-medium text-slate-700">Scan Machine</span>
              </div>
              <div className="hidden sm:block h-px flex-1 bg-slate-200" />
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${barrierOpen ? 'bg-emerald-50 border-emerald-200' : authResult && !authorized ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                {stepIcon(barrierOpen, barrierOpen ? <DoorOpen className="w-2.5 h-2.5" /> : <DoorClosed className="w-2.5 h-2.5" />)}
                <span className="text-xs font-medium text-slate-700">Gate {barrierOpen ? 'Open' : authResult ? 'Closed' : '—'}</span>
              </div>
            </div>

            <div className="mb-3">
              <Input
                label="Scan Driver Badge (Employee Code)"
                value={driverBarcodeInput}
                onChange={e => setDriverBarcodeInput(e.target.value)}
                placeholder="Scan or type the driver's employee code..."
                icon={<UserRound className="w-4 h-4" />}
                suffix={cameraSuffix('driver', 'employee code')}
                autoFocus
              />
              {driverScan.state === 'ok' && driverScan.driver && (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  {driverScan.driver.photoUrl
                    ? <img src={`${API_URL}${driverScan.driver.photoUrl}`} alt={driverScan.driver.name} className="w-14 h-14 rounded-lg object-cover border border-emerald-200 shrink-0" />
                    : <div className="w-14 h-14 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><UserRound className="w-6 h-6" /></div>}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-emerald-800">Driver found</p>
                    <p className="text-sm font-medium text-slate-800 truncate">{driverScan.driver.name}</p>
                    {driverScan.driver.employeeCode && (
                      <p className="text-xs text-emerald-600">{driverScan.driver.employeeCode}</p>
                    )}
                  </div>
                </div>
              )}
              {driverScan.state === 'missing' && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <UserRound className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-800">No driver matches this badge.</p>
                </div>
              )}
            </div>

            {/* Barcode Scan - primary machine identification */}
            <Input
              label={direction === 'IN' ? 'Scan Machine Barcode' : 'Scan Machine Barcode (released machine)'}
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              placeholder="Scan or type the machine barcode..."
              icon={<ScanLine className="w-4 h-4" />}
              suffix={cameraSuffix('machine', 'machine barcode')}
              autoFocus
            />

            {/* Detection feedback */}
            {detection.state === 'detecting' && (
              <p className="mt-2 text-xs text-slate-500">Detecting machine…</p>
            )}
            {detection.state === 'ok' && detection.machine && (() => {
              if (direction === 'OUT') {
                return (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="text-xs">
                      <span className="font-semibold text-emerald-800">Detected:</span>
                      <span className="text-emerald-800"> {detection.machine.serialNumber}</span>
                      <span className="text-emerald-600"> · Released for exit · AT GATE</span>
                    </div>
                  </div>
                );
              }
              const target = detection.machine.plannedSlot ?? detection.machine.currentSlot;
              return (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold text-emerald-800">Detected:</span>
                    <span className="text-emerald-800"> {detection.machine.serialNumber}</span>
                    <span className="text-emerald-600"> · Stage {detection.machine.assemblyStage} · {detection.machine.parkStatus.replace(/_/g, ' ')}</span>
                    {target ? (
                      <span className="text-emerald-600"> · {target.yard?.name ? `${target.yard.name} ` : ''}{slotLabel(target.row, target.col)}</span>
                    ) : (
                      <span className="font-medium text-amber-700"> · No slot assigned</span>
                    )}
                  </div>
                </div>
              );
            })()}
            {detection.state === 'notready' && detection.machine && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                {direction === 'OUT' ? (
                  <p className="text-xs text-red-800">
                    <span className="font-semibold">{detection.machine.serialNumber}</span> is not released for exit - a yard manager must approve the exit request first.
                  </p>
                ) : (
                  <p className="text-xs text-red-800">
                    <span className="font-semibold">{detection.machine.serialNumber}</span> is at stage {detection.machine.assemblyStage} — not ready to move. The gate will reject it.
                  </p>
                )}
              </div>
            )}
            {detection.state === 'missing' && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <ScanLine className="w-4 h-4 text-amber-600 shrink-0" />
                <p className="text-xs text-amber-800">No machine matches this barcode.</p>
              </div>
            )}

            {/* Manual picker fallback */}
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowManualPicker(v => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                {showManualPicker ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                or select machine manually
              </button>
              {showManualPicker && (
                <Select
                  className="mt-2"
                  label="Machine"
                  value={selectedMachine}
                  onChange={e => { setSelectedMachine(e.target.value); setBarcodeInput(''); setDetection({ state: 'none' }); }}
                  placeholder="Select machine..."
                  options={screenMachines.map(m => ({ value: m.id, label: `${m.serialNumber} (Stage ${m.assemblyStage})${m.parkStatus === 'EXITED' ? ' · Return' : ''}` }))}
                />
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
<Button onClick={handleAuthenticate} loading={authenticating} disabled={driverScan.state !== 'ok' || (!selectedMachine && !barcodeInput) || barrierOpen} className="flex-1" icon={<Shield className="w-4 h-4" />}>
                  {direction === 'IN' ? 'Authenticate & Open Barrier' : 'Authorize Exit & Open Barrier'}
                </Button>
              {authResult && (
                <Button variant="ghost" onClick={handleReset} icon={<RotateCcw className="w-4 h-4" />}>
                  Reset
                </Button>
              )}
            </div>

            {/* Physical-only override: raise the barrier without a driver scan. Only
                offered when the administrator enabled it AND configured an open URL. */}
            {barrierConfig.manualOpenEnabled && barrierConfig.openUrl && !barrierOpen && (
              <Button variant="secondary" onClick={handleManualOpen} className="mt-2 w-full" icon={<DoorOpen className="w-4 h-4" />}>
                Manual Open Barrier
              </Button>
            )}

            {/* Auth Result */}
            {authResult && (
              <div className={`mt-3 p-3.5 rounded-lg border ${authorized ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center gap-2">
                  {authResult.result === 'AUTHORIZED' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                  <span className={`text-[13px] font-bold ${authorized ? 'text-emerald-800' : 'text-red-800'}`}>{authResult.result}</span>
                  {authorized && (
                    <Badge variant={barrierOpen ? 'green' : 'gray'}>{barrierOpen ? 'Barrier OPEN' : 'Barrier CLOSED'}</Badge>
                  )}
                </div>
                {authResult.reason && <p className="text-xs text-red-600 mt-1 ml-6">{authResult.reason}</p>}

                {authorized && (
                  <>
                    <p className="text-xs text-slate-700 mt-1.5 ml-6 inline-flex items-center gap-2">
                      {authResult.driver?.photoUrl && (
                        <img src={`${API_URL}${authResult.driver.photoUrl}`} alt={authResult.driver.name} className="w-6 h-6 rounded-full object-cover" />
                      )}
                      <span><span className="font-medium">Driver:</span> {authResult.driver?.name}{authResult.driver?.employeeCode ? ` (${authResult.driver.employeeCode})` : ''}</span>
                    </p>
                    <p className="text-xs text-slate-700 mt-0.5 ml-6">
                      <span className="font-medium">Machine:</span> {authResult.machine?.serialNumber}{authResult.machine?.model ? ` · ${authResult.machine.model}` : ''} · Stage {authResult.machine?.assemblyStage}
                    </p>
                    {slot && (
                      <p className="text-xs text-slate-700 mt-0.5 ml-6">
                        <span className="font-medium inline-flex items-center gap-1"><MapPin className="w-3 h-3" />Slot:</span> {slot.yard?.name ? `${slot.yard.name} · ` : ''}{slotLabel(slot.row, slot.col)}
                      </p>
                    )}
                  </>
                )}

                {/* Barrier close action */}
                {authorized && barrierOpen && (
                  <div className="mt-3 border-t border-emerald-200 pt-3">
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={handleCloseBarrier} loading={closing} variant="secondary" icon={<DoorClosed className="w-4 h-4" />}>
                        Close Barrier
                      </Button>
                      <Button onClick={() => window.print()} variant="ghost" icon={<Printer className="w-4 h-4" />}>
                        Print Driver Pass
                      </Button>
                      <Button onClick={openLabel} variant="ghost" icon={<Download className="w-4 h-4" />}>
                        50mm Label
                      </Button>
                    </div>
                    <p className="text-[11px] text-emerald-700 mt-1.5">{direction === 'IN' ? 'Driver is heading to the slot above.' : 'Machine is leaving the yard.'}</p>
                  </div>
                )}

                {/* Next step */}
                {authorized && !barrierOpen && (
                  <div className="mt-3 border-t border-emerald-200 pt-3">
                    <p className="text-xs text-emerald-800 mb-2">
                      {direction === 'IN'
                        ? 'Next: confirm the machine is physically parked in the slot, then Security will verify it.'
                        : 'Next: the machine has left the yard. It is marked EXITED and the exit request completes.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {direction === 'IN' && (
                        <Button onClick={() => onNavigate?.('parked')} icon={<ArrowRight className="w-4 h-4" />}>
                          Open Parked screen
                        </Button>
                      )}
                      <Button onClick={() => window.print()} variant="ghost" icon={<Printer className="w-4 h-4" />}>
                        Print {direction === 'IN' ? 'Driver Pass' : 'Exit Pass'}
                      </Button>
                      <Button onClick={openLabel} variant="ghost" icon={<Download className="w-4 h-4" />}>
                        50mm Label
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Gate Logs */}
        <SectionCard title="Recent Gate Logs">
          <div className="max-h-[520px] overflow-y-auto space-y-1.5">
            {logs.length === 0 ? (
              <EmptyState title="No gate logs" description="Logs will appear after gate authentications" />
            ) : (
              logs.map(log => (
                <div key={log.id} className={`p-2.5 rounded-lg border text-xs ${log.result === 'AUTHORIZED' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <span className="font-medium text-slate-900 min-w-0 truncate">{log.machine.serialNumber}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant={log.direction === 'OUT' ? 'indigo' : 'gray'}>{log.direction === 'OUT' ? 'OUT' : 'IN'}</Badge>
                      <Badge variant={log.result === 'AUTHORIZED' ? 'green' : 'red'}>{log.result}</Badge>
                    </div>
                  </div>
                  <p className="text-slate-600">Driver: {log.driver.name}</p>
                  <p className="text-slate-400">{formatDateTime(log.createdAt)}</p>
                  <p className="text-slate-400">
                    Barrier: {log.barrierOpenedAt ? 'OPEN' : '—'}{log.barrierOpenedAt && !log.barrierClosedAt ? ' · awaiting close' : log.barrierClosedAt ? ' · CLOSED' : ''}
                  </p>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      </div>

      {/* Print-only driver pass. Portaled into <body> so the @media print rule can
          collapse everything else and print a single clean page. Hidden on screen. */}
      {mounted && authorized && authResult.driver && (direction === 'IN' ? slot : true) && createPortal(
        <div id="gate-pass" className="hidden print-area max-w-2xl mx-auto">
          <div className="border-b-2 border-slate-800 pb-3">
            <p className="text-xl font-bold text-slate-900">{direction === 'IN' ? 'Gate Entry Pass' : 'Gate Exit Authorization'}</p>
            <p className="text-xs text-slate-500">Issued {formatDateTime(issuedAt)} · Ref #{authResult.gateLogId?.slice(0, 8) ?? '—'}</p>
          </div>

          <div className="mt-4 flex items-center gap-4">
            {authResult.driver.photoUrl
              ? <img src={`${API_URL}${authResult.driver.photoUrl}`} alt={authResult.driver.name} className="w-24 h-24 rounded-lg object-cover border border-slate-300" />
              : <div className="w-24 h-24 rounded-lg bg-slate-200 flex items-center justify-center"><UserRound className="w-10 h-10 text-slate-500" /></div>}
            <div>
              <p className="text-xs text-slate-500">Driver</p>
              <p className="text-lg font-bold text-slate-900">{authResult.driver.name}</p>
              <p className="text-sm text-slate-600">Badge: {authResult.driver.employeeCode ?? '—'}</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-4 space-y-2">
            <p className="text-xs text-slate-500">Vehicle</p>
            <p className="text-sm font-semibold text-slate-900">
              {authResult.machine?.serialNumber}{authResult.machine?.model ? ` · ${authResult.machine.model}` : ''} · Stage {authResult.machine?.assemblyStage}
            </p>
            {direction === 'IN' ? (
              <>
                <p className="text-xs text-slate-500">Assigned Slot</p>
                <p className="text-xl font-extrabold text-slate-900">
                  {slot?.yard?.name ? `${slot.yard.name} · ` : ''}{slot ? slotLabel(slot.row, slot.col) : '—'}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-500">Direction</p>
                <p className="text-xl font-extrabold text-slate-900">OUT · Machine left the yard</p>
              </>
            )}
          </div>

          <p className="mt-6 text-xs text-slate-600 border-t border-slate-300 pt-3">
            {direction === 'IN' ? 'Present this pass at security with your ID.' : 'Machine has been recorded as EXITED and the exit request is completed.'}
          </p>

          <div className="mt-4 flex flex-col items-center gap-1">
            {showPassBarcode && (
              <>
                <BarcodeSvg code={passBadge} height={56} />
                <p className="text-[11px] tracking-widest text-slate-600">{passBadge}</p>
              </>
            )}
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Driver badge</p>
          </div>
        </div>,
        document.body
      )}

      {/* 50mm OpenLabel label preview + download */}
      <Modal
        open={!!labelPng}
        onClose={() => setLabelPng(null)}
        title="50mm Gate Label"
        subtitle="Open the PNG in OpenLabel, set the label size to 50mm, and print"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLabelPng(null)}>Close</Button>
            <Button onClick={downloadLabel} icon={<Download className="w-4 h-4" />}>Download PNG</Button>
          </>
        }
      >
        {labelPng && (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="rounded-sm border border-slate-300 bg-white shadow-sm" style={{ width: 180 }}>
              <img src={labelPng} alt="50mm gate label preview" className="w-full h-auto block rounded-[1px]" />
            </div>
            <p className="text-xs text-slate-500 text-center">
              Rendered at 384px wide (≈50mm at 203dpi), so it prints at true size on the 50mm roll.
              The barcode is the driver&apos;s badge code.
            </p>
          </div>
        )}
      </Modal>

      {/* Camera barcode scanner: fills the driver badge or machine barcode field */}
      <BarcodeCameraModal
        open={scannerTarget !== null}
        onClose={() => setScannerTarget(null)}
        onScan={(code) => {
          if (scannerTarget === 'driver') {
            setDriverBarcodeInput(code);
          } else if (scannerTarget === 'machine') {
            setSelectedMachine('');
            setBarcodeInput(code);
          }
        }}
        title={scannerTarget === 'driver' ? 'Scan Driver Badge' : 'Scan Machine Barcode'}
        subtitle="Point the camera at the barcode. It is filled in automatically."
      />
    </div>
  );
}