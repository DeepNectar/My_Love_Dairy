// Google Drive link handling + CORS-friendly image loading.
//
// Drive links are NOT directly embeddable/CORS-safe, so we convert them to
// `https://drive.google.com/thumbnail?id=<ID>&sz=w<N>` (public, works in <img>)
// and route every load through a CORS-enabled image proxy so html2canvas can
// rasterize them into the exported PDF without tainting the canvas.

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

/** Turn any Google Drive share/view link into a direct, embeddable image URL. */
export function resolveImageUrl(link: string, width = 1400): string {
  const id = driveIdFromLink(link);
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
  return (link || '').trim();
}

/** A CORS-enabled proxy URL for any image URL (used for canvas rasterization). */
export function proxiedImageUrl(url: string): string {
  return PROXIES[0](url);
}

/** Load an image as a data: URL (fully CORS-clean, safe for html2canvas/canvas). */
export async function loadImageAsDataUrl(url: string, timeoutMs = 20000): Promise<string> {
  const candidates = [url, ...PROXIES.map((p) => p(url)), ...PROXIES.map((p) => p(proxiedImageUrl(url)))];
  const unique = Array.from(new Set(candidates));

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
