import { jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
const PROXIES = [
  (u) => `https://images.weserv.nl/?url=${encodeURIComponent(u)}&nf=true&max=1&scaleup=true`,
  (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}`
];
function driveIdFromLink(link) {
  const s = (link || "").trim();
  if (!s) return null;
  const patterns = [
    /\/file\/d\/([\w-]{10,})/i,
    /[?&]id=([\w-]{10,})/i,
    /\/d\/([\w-]{10,})/i
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  if (/^[\w-]{20,}$/.test(s)) return s;
  return null;
}
function resolveImageUrl(link, width = 1400) {
  const id = driveIdFromLink(link);
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
  return (link || "").trim();
}
function candidateUrlsForLink(link, width = 1400) {
  const s = (link || "").trim();
  const id = driveIdFromLink(s);
  if (!id) {
    return Array.from(/* @__PURE__ */ new Set([s, ...PROXIES.map((p) => p(s))]));
  }
  const thumb = `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`;
  const lh3 = `https://lh3.googleusercontent.com/d/${id}=w${width}`;
  const uc = `https://drive.usercontent.google.com/download?id=${id}&export=view`;
  const ucFull = `https://drive.usercontent.google.com/download?id=${id}&export=view&authuser=0`;
  const originals = [thumb, lh3, uc, ucFull];
  const viaProxy = originals.flatMap((u) => PROXIES.map((p) => p(u)));
  return Array.from(/* @__PURE__ */ new Set([...originals, ...viaProxy]));
}
function proxiedImageUrl(url) {
  return PROXIES[0](url);
}
async function loadImageAsDataUrl(url, timeoutMs = 2e4) {
  const baseCandidates = driveIdFromLink(url) ? candidateUrlsForLink(url) : [url, ...PROXIES.map((p) => p(url))];
  const unique = Array.from(new Set(baseCandidates));
  let lastErr = null;
  for (const candidate of unique) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(candidate, { mode: "cors", credentials: "omit", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Not an image");
      const mime = blob.type === "image/svg+xml" ? "image/svg+xml" : blob.type || "image/png";
      return await blobToDataUrl(blob.slice(0, Math.min(blob.size, 30 * 1024 * 1024), mime));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not load image (${lastErr instanceof Error ? lastErr.message : "unknown error"}): ${url.slice(0, 90)}`);
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Failed to read image data"));
    fr.readAsDataURL(blob);
  });
}
const inflight = /* @__PURE__ */ new Map();
function loadDataUrlCached(url) {
  const key = url;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = loadImageAsDataUrl(url).finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}
function RobustImg({
  src,
  widthHint = 1400,
  alt = "",
  className,
  style,
  draggable = false
}) {
  const candidates = useMemo(() => candidateUrlsForLink(src, widthHint), [src, widthHint]);
  const [idx, setIdx] = useState(0);
  const [finalSrc, setFinalSrc] = useState(null);
  const triedRef = useRef(0);
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
      loadDataUrlCached(src).then((d) => setFinalSrc(d)).catch(() => {
      });
    }
  }, [candidates, finalSrc, src]);
  return /* @__PURE__ */ jsx(
    "img",
    {
      src: current,
      srcSet: candidates.map((c, i) => `${c} ${Math.round(widthHint * Math.pow(2, i))}w`).join(", "),
      sizes: "100vw",
      alt,
      crossOrigin: "anonymous",
      draggable,
      className,
      style,
      onError: handleError
    }
  );
}
export {
  RobustImg,
  candidateUrlsForLink,
  driveIdFromLink,
  loadDataUrlCached,
  loadImageAsDataUrl,
  proxiedImageUrl,
  resolveImageUrl
};
