// Google Drive link handling + CORS-friendly image loading.
//
// Drive links are NOT directly embeddable/CORS-safe, so we convert them to
// `https://drive.google.com/thumbnail?id=<ID>&sz=w<N>` (public, works in <img>)
// and route every load through a CORS-enabled image proxy so html2canvas can
// rasterize them into the exported PDF without tainting the canvas.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

const PROXIES = [
  (u: string) => `https://images.weserv.nl/?url=${encodeURIComponent(u)}&nf=true&max=1&scaleup=true`,
  (u: string) => `https://wsrv.nl/?url=${encodeURIComponent(u)}`,
];

/** Extract a Drive file ID from any Drive URL (or return the string if it already is one). */
export function driveIdFromLink(link: string): string | null {
  const s = (link || '').trim();
  if (!s) return null;
  const patterns = [
    /\/file\/d\/([\w-]{10,})/i,
    /[?&]id=([\w-]{10,})/i,
    /\/d\/([\w-]{10,})/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  if (/^[\w-]{20,}$/.test(s)) return s; // bare ID
  return null;
}

/** Turn any Google Drive share/view link into a direct, embeddable image URL.
 *  NOTE: `drive.google.com/thumbnail` is NOT CORS-enabled in the browser and
 *  fails when an <img> carries crossOrigin="anonymous" (and under fetch with
 *  mode:'cors'), which broke every preview. lh3.googleusercontent.com serves
 *  the same image WITH `Access-Control-Allow-Origin: *`, so we use it here. */
export function resolveImageUrl(link: string, width = 1400): string {
  const id = driveIdFromLink(link);
  if (id) return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
  return (link || '').trim();
}

/** Every URL variant that can serve a given Drive file (CORS-safe first, so
 *  previews render immediately even with crossOrigin set; then fallbacks). */
export function candidateUrlsForLink(link: string, width = 1400): string[] {
  const s = (link || '').trim();
  const id = driveIdFromLink(s);
  if (!id) {
    // Not a Drive link — original + proxied versions.
    return Array.from(new Set([s, ...PROXIES.map((p) => p(s))]));
  }
  const lh3 = `https://lh3.googleusercontent.com/d/${id}=w${width}`;
  const thumb = `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
  const uc = `https://drive.usercontent.google.com/download?id=${id}&export=view`;
  const ucFull = `https://drive.usercontent.google.com/download?id=${id}&export=view&authuser=0`;
  const originals = [lh3, thumb, uc, ucFull];
  const viaProxy = originals.flatMap((u) => PROXIES.map((p) => p(u)));
  return Array.from(new Set([...originals, ...viaProxy]));
}

/** A CORS-enabled proxy URL for any image URL (used for canvas rasterization). */
export function proxiedImageUrl(url: string): string {
  return PROXIES[0](url);
}

/** Load an image as a data: URL (fully CORS-clean, safe for html2canvas/canvas). */
export async function loadImageAsDataUrl(url: string, timeoutMs = 20000): Promise<string> {
  // If it's a Drive link, try every known-good URL form (direct first, then proxies).
  const baseCandidates = driveIdFromLink(url)
    ? candidateUrlsForLink(url)
    : [url, ...PROXIES.map((p) => p(url))];
  const unique = Array.from(new Set(baseCandidates));

  let lastErr: unknown = null;
  for (const candidate of unique) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(candidate, { mode: 'cors', credentials: 'omit', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Not an image');
      const mime = blob.type === 'image/svg+xml' ? 'image/svg+xml' : blob.type || 'image/png';
      return await blobToDataUrl(blob.slice(0, Math.min(blob.size, 30 * 1024 * 1024), mime));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not load image (${lastErr instanceof Error ? lastErr.message : 'unknown error'}): ${url.slice(0, 90)}`);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Failed to read image data'));
    fr.readAsDataURL(blob);
  });
}

/** Batch loader with de-duplication — shared by the sticker modal and the PDF exporter. */
const inflight = new Map<string, Promise<string>>();
export function loadDataUrlCached(url: string): Promise<string> {
  const key = url;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = loadImageAsDataUrl(url).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

/**
 * <img> that ALWAYS previews correctly:
 * 1. Starts with a proxy URL (CORS-safe, works even when Drive blocks hot-linking).
 * 2. On error, walks through every fallback URL form (thumbnail / lh3 / usercontent …).
 * 3. Final resort: fetches the image as a data: URL so it renders no matter what.
 * `src` may be a Google Drive share link OR a direct image URL.
 */
export function RobustImg({
  src,
  widthHint = 1400,
  alt = '',
  className,
  style,
  draggable = false,
}: {
  src: string;
  widthHint?: number;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  draggable?: boolean;
}) {
  const candidates = useMemo(() => candidateUrlsForLink(src, widthHint), [src, widthHint]);
  const [idx, setIdx] = useState(0);
  const [finalSrc, setFinalSrc] = useState<string | null>(null);
  const triedRef = useRef(0);

  // Reset whenever the source link changes.
  useEffect(() => {
    setIdx(0);
    setFinalSrc(null);
    triedRef.current = 0;
  }, [src]);

  const current = finalSrc ?? candidates[Math.min(idx, candidates.length - 1)];

  const handleError = useCallback(() => {
    if (triedRef.current + 1 < candidates.length) {
      triedRef.current += 1;
      setIdx(triedRef.current);
    } else if (!finalSrc) {
      // All URL forms failed in <img> — load via fetch → data URL (cached).
      loadDataUrlCached(src)
        .then((d) => setFinalSrc(d))
        .catch(() => {
          /* give up silently — element stays hidden via CSS if broken */
        });
    }
  }, [candidates, finalSrc, src]);

  return (
    <img
      src={current}
      alt={alt}
      crossOrigin="anonymous"
      draggable={draggable}
      className={className}
      style={style}
      onError={handleError}
    />
  );
}
