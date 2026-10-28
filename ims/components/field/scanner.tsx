"use client";

import { useEffect, useRef, useState } from "react";
import { Flashlight, FlashlightOff, RefreshCw } from "lucide-react";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import { Button } from "@/components/ui/button";
import { SCAN_FORMATS } from "@/lib/field/scan-formats";

let prepared = false;
/** Load the decoder from our own server (precached), never from a CDN. */
function prepare() {
  if (prepared) return;
  prepared = true;
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? `/zxing/${path}` : prefix + path),
    },
  });
}

type CamState = "starting" | "running" | "denied" | "nocamera" | "insecure" | "busy" | "error";

function feedback() {
  try {
    navigator.vibrate?.(60);
  } catch {}
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1000;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => void ctx.close();
  } catch {}
}

/**
 * Full-width camera with a framing box. Reads QR, Code 128, EAN-13, UPC-A (A11).
 * Beeps and vibrates on a read. If the camera can't be used, explains why;
 * typing the code always stays available next to it (A29).
 */
export function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const onCodeRef = useRef(onCode);
  const [state, setState] = useState<CamState>("starting");
  const [torch, setTorch] = useState({ supported: false, on: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let stream: MediaStream | null = null;
    const last = { code: "", at: 0 };

    async function start() {
      await Promise.resolve();
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return setState("insecure");
      prepare();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        const n = (e as DOMException)?.name;
        return setState(
          n === "NotAllowedError" || n === "SecurityError"
            ? "denied"
            : n === "NotFoundError" || n === "OverconstrainedError"
              ? "nocamera"
              : n === "NotReadableError" || n === "AbortError"
                ? "busy"
                : "error",
        );
      }
      if (stopped || !video.current) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      track.current = stream.getVideoTracks()[0] ?? null;
      const caps = (track.current?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      setTorch({ supported: !!caps.torch, on: false });
      setState("running");
      const detector = new BarcodeDetector({ formats: [...SCAN_FORMATS] });
      const tick = async () => {
        if (stopped) return;
        try {
          if (v.readyState >= 2 && v.videoWidth > 0) {
            const found = await detector.detect(v);
            const raw = found[0]?.rawValue?.trim();
            if (raw && !(raw === last.code && Date.now() - last.at < 2500)) {
              last.code = raw;
              last.at = Date.now();
              feedback();
              onCodeRef.current(raw);
            }
          }
        } catch {
          /* one frame failed; keep scanning */
        }
        if (!stopped) timer = window.setTimeout(tick, 180);
      };
      void tick();
    }
    void start();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
    };
  }, [attempt]);

  async function toggleTorch() {
    const on = !torch.on;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch((t) => ({ ...t, on }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  }

  const problem = PROBLEMS[state as keyof typeof PROBLEMS];
  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black" aria-label="Camera">
        <video ref={video} className="size-full object-cover" playsInline muted autoPlay aria-hidden />
        {state === "running" && (
          <>
            <div
              className="pointer-events-none absolute top-1/2 left-1/2 h-[42%] w-[76%] -translate-x-1/2 -translate-y-1/2 rounded-lg border-4 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]"
              aria-hidden
            />
            <p className="absolute inset-x-0 bottom-2 text-center text-sm font-medium text-white" aria-live="polite">
              Point at a QR code or barcode
            </p>
            {torch.supported && (
              <Button
                type="button"
                size="icon-lg"
                variant="secondary"
                className="absolute top-2 right-2"
                onClick={toggleTorch}
                aria-pressed={torch.on}
                aria-label={torch.on ? "Turn light off" : "Turn light on"}
              >
                {torch.on ? <FlashlightOff aria-hidden /> : <Flashlight aria-hidden />}
              </Button>
            )}
          </>
        )}
        {state === "starting" && (
          <p className="absolute inset-0 flex items-center justify-center text-white">Starting camera…</p>
        )}
        {problem && (
          <div
            className="absolute inset-0 flex flex-col items-start justify-center gap-2 overflow-y-auto bg-card p-4 text-left"
            role="alert"
          >
            <p className="text-lg font-semibold">{problem.title}</p>
            {problem.body}
            {problem.retry && (
              <Button type="button" variant="outline" onClick={() => (setState("starting"), setAttempt((a) => a + 1))}>
                <RefreshCw aria-hidden /> Try the camera again
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const PROBLEMS = {
  denied: {
    title: "The camera is blocked for IMS",
    retry: true,
    body: (
      <div className="flex flex-col gap-2 text-[15px]">
        <p>You can still type the code below. To allow the camera:</p>
        <p>
          <b>Android (Chrome):</b> tap the icon left of the web address → Permissions → Camera → Allow. Then tap “Try
          the camera again”.
        </p>
        <p>
          <b>iPhone:</b> Settings → Safari → Camera → Allow. In Safari you can also tap “aA” → Website Settings → Camera
          → Allow.
        </p>
      </div>
    ),
  },
  nocamera: {
    title: "No camera found",
    retry: true,
    body: <p>This device has no camera we can use. Type the code below.</p>,
  },
  insecure: {
    title: "The camera needs a secure connection",
    retry: false,
    body: <p>Browsers only allow the camera on https pages. Type the code below, or ask IT to open IMS over https.</p>,
  },
  busy: {
    title: "The camera is in use",
    retry: true,
    body: <p>Another app is using the camera. Close it, then try again. Or type the code below.</p>,
  },
  error: { title: "The camera didn't start", retry: true, body: <p>Try again, or type the code below.</p> },
} as const;
