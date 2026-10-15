'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Camera, CameraOff, Loader2 } from 'lucide-react';

interface BarcodeCameraModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
  subtitle?: string;
}

type Status = 'idle' | 'starting' | 'scanning' | 'error';

const friendlyError = (err: unknown): string => {
  const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err ?? '');
  const m = msg.toLowerCase();
  if (m.includes('permission') || m.includes('denied')) return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  if (m.includes('notfound') || m.includes('no camera') || m.includes('devices not found') || m.includes('requested device not found')) return 'No camera was found on this device.';
  if (m.includes('notreadable') || m.includes('in use') || m.includes('could not start video source')) return 'The camera is already in use by another app. Close it and try again.';
  if (m.includes('secure') || m.includes('https') || m.includes('insecure')) return 'Camera access requires a secure (HTTPS) connection.';
  return msg || 'Unable to start the camera.';
};

export default function BarcodeCameraModal({ open, onClose, onScan, title = 'Scan Barcode', subtitle }: BarcodeCameraModalProps) {
  const reactId = useId();
  const elementId = `barcode-camera-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  // Keep the latest callbacks in refs so the start effect never needs to re-run
  // (re-running would tear down and restart the camera on every parent render).
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onScanRef.current = onScan;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let handled = false;
    let scanner: import('html5-qrcode').Html5Qrcode | null = null;

    const stopScanner = async (s: import('html5-qrcode').Html5Qrcode | null) => {
      if (!s) return;
      try {
        const state = s.getState();
        // 2 = SCANNING, 3 = PAUSED - only stop when a stream is actually running.
        if (state === 2 || state === 3) await s.stop();
        s.clear();
      } catch {
        // Stopping a scanner that never fully started can throw; ignore.
      }
    };

    (async () => {
      setStatus('starting');
      setError('');
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (cancelled) return;

        scanner = new Html5Qrcode(elementId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
          ],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        });

        const config = { fps: 10 };
        const onDecoded = (decodedText: string) => {
          if (handled || cancelled) return;
          handled = true;
          const code = decodedText.trim();
          if (code) onScanRef.current(code);
          onCloseRef.current();
        };
        const ignore = () => {};

        let started = false;
        try {
          // Prefer the rear camera on phones/tablets.
          await scanner.start({ facingMode: 'environment' }, config, onDecoded, ignore);
          started = true;
        } catch (err) {
          if (cancelled) return;
          // Desktop / webcams may not expose a rear camera - fall back to the first device.
          const cameras = await Html5Qrcode.getCameras().catch(() => []);
          if (cameras.length > 0) {
            await scanner.start(cameras[0].id, config, onDecoded, ignore);
            started = true;
          } else {
            throw err;
          }
        }

        if (!started) return;
        if (cancelled) {
          await stopScanner(scanner);
          return;
        }
        setStatus('scanning');
      } catch (err) {
        scanner = null;
        if (!cancelled) {
          setError(friendlyError(err));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      void stopScanner(scanner);
    };
  }, [open, elementId]);

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle ?? 'Point the camera at the barcode'} size="sm">
      <div className="space-y-3">
        <div className="relative rounded-lg overflow-hidden bg-black aspect-square">
          <div
            id={elementId}
            className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover [&_canvas]:hidden [&_img]:hidden"
          />
          {status !== 'scanning' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-slate-300">
              {status === 'error'
                ? <CameraOff className="w-8 h-8" />
                : <Loader2 className="w-8 h-8 animate-spin" />}
              <p className="text-xs">{status === 'error' ? 'Camera unavailable' : 'Starting camera…'}</p>
            </div>
          )}
        </div>

        {status === 'error' && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <CameraOff className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800">{error}</p>
          </div>
        )}

        {status === 'scanning' && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Camera className="w-3.5 h-3.5" /> Hold the barcode steady inside the frame.
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
