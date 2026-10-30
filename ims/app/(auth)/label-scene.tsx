import bwipjs from "bwip-js/node";

// A real IMS label (same 70 × 37 mm layout and code types as /labels), drawn once
// per server start. The QR holds a dummy payload, never a real record (§6.3).
const svg = (bcid: string, text: string, extra: Record<string, unknown> = {}) =>
  bwipjs.toSVG({ bcid, text, ...extra } as Parameters<typeof bwipjs.toSVG>[0]);
const QR = svg("qrcode", "ims:demo", { eclevel: "M" });
const BAR = svg("code128", "TOOL-0002", { height: 7, includetext: false });

const CELLS = 3 * 9;
const LIVE = 13; // centre cell, so the phone band crops around it

/**
 * The sign-in visual: an A4 label sheet on its backing paper, with one printed
 * label left that lifts off and gets scanned (auth.css). Decorative only.
 */
export function LabelScene() {
  return (
    <div className="ls-panel" aria-hidden>
      <div className="ls-sheet">
        {Array.from({ length: CELLS }, (_, i) => (
          <div key={i} className="ls-cell">
            {i === LIVE && (
              <>
                <div className="ls-label">
                  <div className="ls-qr" dangerouslySetInnerHTML={{ __html: QR }} />
                  <div className="ls-text">
                    <span className="ls-code">TOOL-0002</span>
                    <span className="ls-title">Cordless drill</span>
                    <span className="ls-sub">S/N MFG-822</span>
                    <div className="ls-bar" dangerouslySetInnerHTML={{ __html: BAR }} />
                  </div>
                  <span className="ls-laser" />
                </div>
                <span className="ls-found">✓ Found</span>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="ls-caption">
        <span className="ls-caption-main">Stock and equipment for every site.</span>
        <span className="ls-caption-sub">Scan · Count · Borrow · Works offline in the field</span>
      </p>
    </div>
  );
}
