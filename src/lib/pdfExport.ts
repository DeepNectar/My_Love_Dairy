// A4 PDF export for the diary.
//
// Why the old export produced blank pages / missing header & footer:
//   html2canvas silently fails on cross-origin Google Drive images and on
//   complex modern CSS — it painted white bands where the header/footer should be.
// New pipeline (no html2canvas):
//   1. Every <img> (header photo, both signatures, stickers) is fetched and
//      swapped for a CORS-clean data: URL BEFORE anything is measured/drawn.
//   2. Each DOM section is snapshotted into an SVG <foreignObject> with fully
//      inlined computed styles + XHTML-escaped markup, then decoded by the
//      browser's own SVG renderer onto a canvas at ~300 DPI.
//   3. Sections are packed into exact A4 sheets (210×297mm, narrow 8mm margins)
//      honouring the same pagination the user flipped through on-screen.
//   4. The header band sits on top of EVERY sheet, the signature footer is
//      pinned to the bottom of EVERY sheet, and "Page N of M" is stamped in
//      the bottom-right corner.
import { jsPDF } from 'jspdf';
import { loadDataUrlCached, driveIdFromLink } from './images';

export const A4_MM = { width: 210, height: 297 } as const;

/** Narrow margin used both on-site and in the exported PDF (mm). */
export const NARROW_MARGIN_MM = 8;

export const CSS_PX_PER_MM = 96 / 25.4;   // browser CSS pixel size
const PRINT_SCALE = 300 / 96;             // canvas pixels per CSS pixel (≈300 DPI output)

/** Sheet size in CSS pixels (what the DOM is laid out in). */
export const SHEET_W_CSS = Math.round(A4_MM.width * CSS_PX_PER_MM);  // ~794
export const SHEET_H_CSS = Math.round(A4_MM.height * CSS_PX_PER_MM); // ~1123
export const MARGIN_CSS = Math.round(NARROW_MARGIN_MM * CSS_PX_PER_MM);

const CANVAS_W = Math.round(SHEET_W_CSS * PRINT_SCALE);
const CANVAS_H = Math.round(SHEET_H_CSS * PRINT_SCALE);

/** Usable content area inside one sheet (CSS px), leaving room for the page number. */
export const CONTENT_W_CSS = SHEET_W_CSS - MARGIN_CSS * 2;
/** Vertical space reserved at the bottom of every sheet for "Page N of M" (px). */
export const PAGE_NUMBER_RESERVE_CSS = Math.round(10 * CSS_PX_PER_MM);
/** Horizontal space reserved at the bottom-right corner for "Page N of M" (px). */
export const PAGE_NUMBER_RESERVE_W_CSS = Math.round(45 * CSS_PX_PER_MM);
/** Gap between the header band and the content, and above the footer band (px). */
export const BAND_GAP_CSS = Math.round(2 * CSS_PX_PER_MM);
/** Tiny safety buffer so rounding never pushes a line past the sheet edge (px). */
export const FLOW_SAFETY_CSS = 6;

/**
 * Height available to flowing content inside one A4 sheet, computed from the
 * REAL header/footer bands measured at print width. The on-screen paginator
 * and the PDF exporter call this SAME function — that is what guarantees the
 * exported PDF matches the preview exactly: same blocks, same page breaks.
 */
export function computeAvailableFlowHeightCss(headerH: number, footerH: number): number {
  return (
    SHEET_H_CSS -
    MARGIN_CSS * 2 -
    (headerH + BAND_GAP_CSS) -
    (footerH + BAND_GAP_CSS) -
    PAGE_NUMBER_RESERVE_CSS -
    FLOW_SAFETY_CSS
  );
}

export interface PdfBand {
  /** id of the DOM node that holds the band markup (rendered off-screen) */
  nodeId: string;
  /** where the band goes on the sheet */
  position: 'top' | 'bottom';
}

/** A sticker (image from a link) that should decorate the exported sheets. */
export interface PdfSticker {
  id: string;
  url: string;       // Google Drive share link or direct image URL
  page?: number;     // explicit 0-based sheet index (undefined → random placement)
  xPct?: number;     // horizontal position as % of the sheet width
  yPct?: number;     // vertical position as % of the sheet height
  sizePct?: number;  // width as % of the sheet width
  rotate?: number;   // degrees
}

/**
 * Deterministic pseudo-random numbers from a string seed (FNV-1a hash +
 * xorshift). Same sticker ID always yields the same "random" position — so the
 * preview and the exported PDF place every scattered sticker identically, and
 * re-exports never shuffle the layout.
 */
export function seededRandomFrom(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h << 13; h = h >>> 0;
  h ^= h >> 17;
  h ^= h << 5; h = h >>> 0;
  return (h >>> 0) / 4294967296;
}

/**
 * Resolve one sticker onto ONE or MORE A4 sheets ("as recommended" scatter mode):
 *  - explicit `page`           → that sheet only, at the given (or random) spot
 *  - `page: -1`                → exactly one randomly chosen sheet
 *  - no page info at all       → the WHOLE document: one copy on every sheet,
 *                                each at its own deterministic random position
 * The SAME function runs in the on-screen preview and in the exporter, which
 * is what keeps the PDF identical to the HTML site preview.
 */
export function resolveStickerPlacements(
  s: PdfSticker,
  totalPages: number,
): Array<{ page: number; xPct: number; yPct: number; sizePct: number; rotate: number }> {
  const T = Math.max(1, totalPages);
  const size = s.sizePct ?? 11;               // modest footprint when scattering
  const baseRotate = s.rotate ?? -4;
  const mk = (page: number, q: number) => ({
    page,
    // keep stickers fully inside the sheet, clear of the 8mm margins & corner number
    xPct: s.xPct ?? 6 + q * (86 - size),      // 6% … 92%-size
    yPct: s.yPct ?? 14 + ((q * 7919) % 1000) / 1000 * (70 - size * 0.5), // 14% … ~84%
    sizePct: size,
    rotate: s.rotate ?? Math.round((baseRotate + ((q * 104729) % 13) - 6) * 10) / 10,
  });
  if (typeof s.page === 'number') {
    if (s.page === -1) return [mk(Math.floor(seededRandomFrom(`${s.id}:page`) * T), seededRandomFrom(`${s.id}:pos`))];
    return [mk(Math.max(0, Math.min(T - 1, s.page)), seededRandomFrom(`${s.id}:pos`))];
  }
  // No page pinned → decorate every sheet, one deterministic random spot each.
  return Array.from({ length: T }, (_, p) => mk(p, seededRandomFrom(`${s.id}:${p}`)));
}

/**
 * A fully pre-rendered sheet. When supplied, the exporter drops that exact
 * bitmap onto its A4 page — this is how the PDF becomes literally "the same
 * page that is there in the HTML site preview": the browser itself paints the
 * complete sheet (header band on top, all entries, footer band at the bottom,
 * page number, stickers), and the exporter only assembles the sheets.
 */
export interface PreRenderedPage {
  canvas: HTMLCanvasElement;
}

export interface PdfOptions {
  blocksSelector: string;
  bands?: PdfBand[];
  /** Stickers scattered onto the sheets (unresolved Drive links are loaded automatically). */
  stickers?: PdfSticker[];
  /**
   * Optional ready-made sheets produced by `renderSheetNode` (one per visible
   * preview page). Takes precedence over the block-flow pipeline when given.
   */
  pages?: PreRenderedPage[];
  fileName: string;
  onPageProgress?: (done: number, total: number) => void;
  /**
   * Optional: returns a cleaned clone of a DOM node right before it is
   * rasterized (e.g. strip interactive-only chrome like hover buttons), so the
   * PDF mirrors the visual preview instead of the raw UI markup.
   */
  prepareNode?: (node: HTMLElement) => HTMLElement;
}

interface MeasuredBlock {
  el: HTMLElement;
  height: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nextFrame() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await wait(0);
}

/** Resolve any image reference (Drive share link or direct URL) to a data: URL. */
async function toDataUrlAnyForm(ref: string): Promise<string> {
  const attempts = [ref];
  const id = driveIdFromLink(ref);
  if (id && !/^https?:/i.test(ref)) attempts.push(`https://drive.google.com/thumbnail?id=${id}&sz=w1600`);
  let lastErr: unknown = null;
  for (const a of attempts) {
    try {
      return await loadDataUrlCached(a);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not load sticker image');
}

/** Load a sticker image into an <img> element (data URL, CORS-clean). */
async function hydrateStickerImg(img: HTMLImageElement, url: string) {
  const dataUrl = await toDataUrlAnyForm(url);
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.removeAttribute('crossorigin');
    img.src = dataUrl;
  });
}

/** Replace every remote <img src> inside `root` with a CORS-clean data URL. */
async function inlineImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      try {
        await hydrateStickerImg(img, src);
      } catch {
        /* keep going: a single unreachable image must not fail the whole PDF */
      }
    })
  );
}

/**
 * Pin each image's DRAWN size to the exact box it occupies on the live page
 * before rasterizing. The header photo and both signatures are laid out by
 * CSS (32mm square / up to 62×17mm), but once their src becomes a data URL
 * inside the SVG snapshot they lose access to the stylesheet's flex sizing —
 * they would then paint at intrinsic pixel size and blow the bands apart
 * ("photo/signature not fitting in header & footer"). Reading offsetWidth/
 * Height from the ORIGINAL nodes (still mounted, still CSS-sized) and writing
 * those numbers as inline styles onto the clone guarantees the images fit the
 * header and footer perfectly in the exported PDF, exactly like the preview.
 */
function pinImageSizes(node: HTMLElement, clone: HTMLElement): void {
  const origImgs = Array.from(node.querySelectorAll('img'));
  const cloneImgs = Array.from(clone.querySelectorAll('img'));
  const n = Math.min(origImgs.length, cloneImgs.length);
  for (let i = 0; i < n; i++) {
    const o = origImgs[i];
    const c = cloneImgs[i];
    const w = o.offsetWidth || o.clientWidth || Number(o.getAttribute('width')) || 0;
    const h = o.offsetHeight || o.clientHeight || Number(o.getAttribute('height')) || 0;
    if (w > 0) {
      c.style.width = `${Math.round(w)}px`;
      c.style.maxWidth = `${Math.round(w)}px`;
    }
    if (h > 0) {
      c.style.height = `${Math.round(h)}px`;
      c.style.maxHeight = `${Math.round(h)}px`;
    }
    // Keep the visual crop behaviour the site shows (cover for the header
    // photo, contain for the signatures) instead of stretching.
    const fit = getComputedStyle(o).objectFit;
    if (fit) c.style.objectFit = fit;
  }
}

function measureBlocks(container: HTMLElement): MeasuredBlock[] {
  const out: MeasuredBlock[] = [];
  for (const child of Array.from(container.children) as HTMLElement[]) {
    const h = child.offsetHeight || child.scrollHeight;
    if (h > 0) out.push({ el: child, height: h });
  }
  return out;
}

/**
 * Split an oversized block into page-sized slices by cloning it and revealing
 * only the vertical slice that fits each sheet (offset-top cropping). Works
 * even for blocks with no splittable children — nothing is ever clipped away.
 */
function sliceOversized(block: MeasuredBlock, maxH: number): MeasuredBlock[] {
  const out: MeasuredBlock[] = [];
  // Advance the crop window a little less than its full height so consecutive
  // slices overlap slightly — any reflow drift inside the SVG rasterizer can
  // then never hide lines of text at a slice boundary.
  const overlap = Math.round(6 * CSS_PX_PER_MM);
  const step = Math.max(1, maxH - overlap);
  let offset = 0;
  while (offset < block.height) {
    const sliceH = Math.min(maxH, block.height - offset);
    const clone = block.el.cloneNode(true) as HTMLElement;
    clone.style.position = 'relative';
    clone.style.top = `-${offset}px`;
    // wrapper clips to exactly one printable slice of the block
    const wrapper = document.createElement('div');
    wrapper.style.width = `${CONTENT_W_CSS}px`;
    wrapper.style.height = `${sliceH}px`;
    wrapper.style.overflow = 'hidden';
    wrapper.appendChild(clone);
    out.push({ el: wrapper, height: sliceH });
    offset += step;
  }
  return out.length ? out : [block];
}

/**
 * Safety net for sliced oversized blocks: a clone rendered inside an SVG
 * foreignObject can grow/shrink by a few pixels compared to the live DOM
 * (font substitution, rounding). If a slice's natural height exceeds the
 * window it was given, shift the crop offset a bit further so the visible
 * window always fits the page — content is never cut off at the bottom and
 * never spills into the footer band.
 */
function fitSlicedBlock(el: HTMLElement, targetH: number, maxExtra: number): void {
  if (!el.style || el.style.top === '') return; // only applies to slice wrappers
  let currentTop = parseFloat(el.style.top) || 0;
  const origTop = currentTop;
  let guard = 0;
  while (guard++ < 60 && el.scrollHeight > targetH + 1 && -currentTop < maxExtra) {
    currentTop -= Math.ceil(el.scrollHeight - targetH);
    el.style.top = `${currentTop}px`;
  }
  // Never shift the crop so far that the top of the window goes blank.
  if (el.firstElementChild instanceof HTMLElement && el.firstElementChild.offsetHeight < targetH) {
    currentTop = origTop;
    el.style.top = `${currentTop}px`;
  }
}

/** Re-flow measured blocks into A4 sheets — greedy fill, nothing dropped. */
export function flowIntoPages(blocks: MeasuredBlock[], availableHeightCss: number): MeasuredBlock[][] {
  const maxH = availableHeightCss;
  const pages: MeasuredBlock[][] = [];
  let current: MeasuredBlock[] = [];
  let used = 0;

  const pushPage = () => {
    if (current.length) { pages.push(current); current = []; used = 0; }
  };

  for (const b of blocks) {
    if (b.height > maxH) {
      pushPage();
      for (const part of sliceOversized(b, maxH)) {
        current.push(part);
        used += part.height;
        if (used >= maxH) pushPage();
      }
      continue;
    }
    if (used + b.height > maxH) pushPage();
    current.push(b);
    used += b.height;
  }
  pushPage();
  if (pages.length === 0) pages.push([]);
  return pages;
}

// ---------------------------------------------------------------------------
// SVG snapshot rasterizer
// ---------------------------------------------------------------------------

const XML_ATTR_ESC: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };
const escapeAttr = (s: string) => s.replace(/[&"<>]/g, (c) => XML_ATTR_ESC[c]);
const escapeText = (s: string) => s.replace(/[&<>]/g, (c) => XML_ATTR_ESC[c] ?? c);

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Serialize an element tree as well-formed XHTML (void elements self-closed). */
function toXhtml(el: Element): string {
  const ser = (n: Node): string => {
    if (n.nodeType === 3) return escapeText(n.textContent || '');
    if (n.nodeType !== 1) return '';
    const e = n as Element;
    const tag = e.tagName.toLowerCase();
    let open = `<${tag}`;
    for (const attr of Array.from(e.attributes)) {
      open += ` ${attr.name}="${escapeAttr(attr.value)}"`;
    }
    if (VOID_TAGS.has(tag)) return `${open}/>`;
    open += '>';
    let inner = '';
    for (const c of Array.from(e.childNodes)) inner += ser(c);
    return `${open}${inner}</${tag}>`;
  };
  return ser(el);
}

/** Inline computed styles so the cloned markup renders identically inside an SVG foreignObject. */
function inlineComputedStyles(root: HTMLElement): string {
  const nodes: HTMLElement[] = [root, ...(Array.from(root.querySelectorAll('*')) as HTMLElement[])];
  for (const n of nodes) {
    const cs = getComputedStyle(n);
    let style = '';
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      const val = cs.getPropertyValue(prop);
      if (!val) continue;
      // skip noise that would bloat the payload
      if (prop.startsWith('-webkit-text-') || prop === 'd' || prop.startsWith('--')) continue;
      style += `${prop}:${val};`;
    }
    n.setAttribute('style', style);
  }
  return toXhtml(root);
}

/**
 * Snapshot a DOM node into an SVG rendered by the browser's native SVG engine.
 * Throws only if the browser itself refuses to decode the SVG (logged for debug).
 */
async function rasterizeNode(
  el: HTMLElement,
  widthCss: number,
  opts?: { heightOverride?: number; prepare?: (node: HTMLElement) => HTMLElement },
): Promise<{ canvas: HTMLCanvasElement; heightCss: number }> {
  const isSlice = typeof opts?.heightOverride === 'number';
  const heightCss = isSlice ? (opts as { heightOverride: number }).heightOverride : el.offsetHeight || el.scrollHeight;
  // Give the caller a chance to clean the snapshot (strip UI-only chrome).
  const rawClone = opts?.prepare ? opts.prepare(el) : (el.cloneNode(true) as HTMLElement);
  const clone = rawClone;
  // Header photo / signatures must keep their on-page box size in the PDF.
  pinImageSizes(el, clone);
  clone.style.width = `${widthCss}px`;
  if (isSlice) {
    // Slice wrapper: keep the fixed-height clipping window EXACTLY as the
    // on-screen paginator created it. The old code forced height:auto /
    // overflow:visible here, which made every cropped block render at its
    // FULL height — that is what pushed text past the page bottom into the
    // footer band and produced "missing data" in the exported PDF.
    clone.style.height = `${heightCss}px`;
    clone.style.maxHeight = `${heightCss}px`;
    clone.style.overflow = 'hidden';
    clone.style.boxSizing = 'border-box';
    clone.style.position = 'relative';
    clone.style.transform = 'none';
    clone.style.margin = '0';
    fitSlicedBlock(clone, heightCss, Math.round(15 * CSS_PX_PER_MM));
  } else {
    clone.style.height = 'auto';
    clone.style.maxHeight = 'none';
    clone.style.position = 'static';
    clone.style.transform = 'none';
    clone.style.margin = '0';
    clone.style.overflow = 'visible';
  }

  const inner = inlineComputedStyles(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthCss}" height="${heightCss}" viewBox="0 0 ${widthCss} ${heightCss}">` +
    `<foreignObject width="${widthCss}" height="${heightCss}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>` +
    `</foreignObject></svg>`;

  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG snapshot failed to decode.'));
      img.src = url;
    });
  } catch (err) {
    console.error('[pdf] rasterization failed for node:', el.id || el.className, err);
    throw err;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthCss * PRINT_SCALE);
  // The SVG viewport height is the trusted layout height (slice windows use
  // their exact slice height), so the canvas must match it — using the img's
  // natural size here could introduce a mismatch that shifts drawn content.
  canvas.height = Math.max(1, Math.round(heightCss * PRINT_SCALE));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, heightCss };
}

/** Rasterize a single content block straight from the live DOM node. */
async function rasterizeBlock(
  b: MeasuredBlock,
  prepare?: (node: HTMLElement) => HTMLElement,
): Promise<HTMLCanvasElement> {
  // Slice wrappers (fixed-height crop windows) must be rendered with their
  // exact window height — see rasterizeNode's `heightOverride` path.
  const isSlice = b.el.style.height !== '' && parseFloat(b.el.style.top || '') < 0;
  const { canvas } = await rasterizeNode(
    b.el,
    CONTENT_W_CSS,
    isSlice ? { heightOverride: b.height, prepare } : { prepare },
  );
  return canvas;
}

/**
 * Measure a container's true content height without letting flex children
 * shrink. `.a4-print-area { flex:1; min-height:0 }` silently clips whatever
 * doesn't fit, so offsetHeight of such nodes lies about overflow — exactly
 * how overflowing data used to vanish from the PDF instead of flowing onto
 * the next page. Temporarily neutralising the flex constraints exposes the
 * real scrollHeight, then everything is restored.
 */
function measureTrueHeight(el: HTMLElement): number {
  const prevFlex = el.style.flex;
  const prevMinH = el.style.minHeight;
  const prevOverflow = el.style.overflow;
  el.style.flex = '0 0 auto';
  el.style.minHeight = '0';
  el.style.overflow = 'visible';
  const h = Math.max(el.scrollHeight, el.offsetHeight);
  el.style.flex = prevFlex;
  el.style.minHeight = prevMinH;
  el.style.overflow = prevOverflow;
  return h;
}

/** Draw one sticker onto a sheet canvas as a polaroid-style tilted photo. */
function drawStickerOnSheet(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  p: { xPct: number; yPct: number; sizePct: number; rotate: number },
) {
  const S = PRINT_SCALE;
  const wPx = (p.sizePct / 100) * SHEET_W_CSS * S;
  if (!img.naturalWidth || !img.naturalHeight || wPx < 4) return;
  const hPx = wPx * (img.naturalHeight / img.naturalWidth);
  const cx = (p.xPct / 100) * SHEET_W_CSS * S + wPx / 2;
  const cy = (p.yPct / 100) * SHEET_H_CSS * S + hPx / 2;
  const pad = Math.max(3, wPx * 0.05);      // white polaroid frame
  const bottomPad = pad * 2.2;              // thicker base like a printed photo
  const rad = (p.rotate * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  // soft drop shadow
  ctx.shadowColor = 'rgba(60, 30, 10, 0.35)';
  ctx.shadowBlur = pad * 2.2;
  ctx.shadowOffsetX = pad * 0.7;
  ctx.shadowOffsetY = pad * 1.1;
  ctx.fillStyle = '#ffffff';
  roundRectPath(ctx, -wPx / 2 - pad, -hPx / 2 - pad, wPx + pad * 2, hPx + pad + bottomPad, pad * 0.8);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  // hairline border so the white frame stays visible on light paper
  ctx.strokeStyle = 'rgba(180, 83, 9, 0.35)';
  ctx.lineWidth = Math.max(1, pad * 0.25);
  roundRectPath(ctx, -wPx / 2 - pad, -hPx / 2 - pad, wPx + pad * 2, hPx + pad + bottomPad, pad * 0.8);
  ctx.stroke();
  ctx.drawImage(img, -wPx / 2, -hPx / 2, wPx, hPx);
  ctx.restore();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Wait until every <img> inside `root` has settled (loaded or failed). */
async function waitForImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );
}

// ---------------------------------------------------------------------------
// WHOLE-SHEET RENDERER ("what you see is what you print")
// ---------------------------------------------------------------------------

const SHEET_PX_W = Math.round(210 * CSS_PX_PER_MM); // 210mm laid out at true CSS size
const SHEET_PX_H = Math.round(297 * CSS_PX_PER_MM); // 297mm

/**
 * Rasterize a complete A4 preview node (`.a4-page`: header band on top, all
 * entries in the middle, signature footer at the bottom, page number, pinned
 * stickers) into an exact ~300 DPI sheet bitmap. The node is temporarily
 * returned to its TRUE printed size (the on-screen sheet is shrunk with a CSS
 * scale transform), swapped to fully inlined/CORS-clean markup so the browser's
 * own SVG engine paints it identically to the site preview, then restored.
 */
export async function renderSheetNode(
  node: HTMLElement,
  opts?: { prepare?: (n: HTMLElement) => HTMLElement },
): Promise<HTMLCanvasElement> {
  // Inline remote images (Drive links) as data URLs BEFORE snapshotting —
  // an SVG foreignObject can never load external resources itself.
  await inlineImages(node);
  await waitForImages(node);

  const prevTransform = node.style.transform;
  const prevAnimation = node.style.animation;
  node.style.transform = 'none';
  node.style.animation = 'none';

  try {
    const rawClone = opts?.prepare ? opts.prepare(node) : (node.cloneNode(true) as HTMLElement);
    const clone = rawClone;
    // Freeze the header photo & both signatures at EXACTLY the box size they
    // occupy on the visible preview sheet — this is what makes them "fit
    // properly in the header and in the footer" in the exported PDF instead
    // of painting at their huge intrinsic pixel size.
    pinImageSizes(node, clone);
    clone.style.width = `${SHEET_PX_W}px`;
    clone.style.height = `${SHEET_PX_H}px`;
    clone.style.boxSizing = 'border-box';
    clone.style.position = 'relative';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.style.transform = 'none';
    clone.style.animation = 'none';
    clone.style.margin = '0';

    const inner = inlineComputedStyles(clone);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_PX_W}" height="${SHEET_PX_H}" viewBox="0 0 ${SHEET_PX_W} ${SHEET_PX_H}">` +
      `<foreignObject width="${SHEET_PX_W}" height="${SHEET_PX_H}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml">${inner}</div>` +
      `</foreignObject></svg>`;

    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Sheet snapshot failed to decode.'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    node.style.transform = prevTransform;
    node.style.animation = prevAnimation;
  }
}

export async function exportDiaryToA4Pdf(opts: PdfOptions): Promise<number> {
  // ================= FAST PATH: pre-rendered whole sheets =================
  // The app rasterizes EVERY visible preview page (complete with header,
  // footer, all entries, page numbers and scattered stickers) and hands the
  // finished bitmaps over here. The PDF is then literally the same pages the
  // user sees on the site — nothing else can shift, clip or go missing.
  if (opts.pages && opts.pages.length > 0) {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    for (let i = 0; i < opts.pages.length; i++) {
      if (i > 0) pdf.addPage();
      pdf.addImage(opts.pages[i].canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, A4_MM.width, A4_MM.height, undefined, 'FAST');
      opts.onPageProgress?.(i + 1, opts.pages.length);
      await nextFrame();
    }
    pdf.save(opts.fileName);
    return opts.pages.length;
  }

  // ============ FALLBACK PATH: flow blocks + stamp bands ourselves =========
  const container = document.querySelector<HTMLElement>(opts.blocksSelector);
  if (!container) throw new Error('Nothing to export yet — add some entries first.');

  // --- Stickers (from links) prepared independently of the DOM flow ---
  // Each sticker image is loaded once as a CORS-clean data URL and decoded so
  // its true aspect ratio is known before it is drawn onto the sheets.
  const preparedStickers: Array<{ img: HTMLImageElement; sticker: PdfSticker }> = [];
  for (const s of opts.stickers ?? []) {
    try {
      const dataUrl = await toDataUrlAnyForm(s.url);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('sticker decode failed'));
        img.src = dataUrl;
      });
      preparedStickers.push({ img, sticker: s });
    } catch {
      /* an unreachable sticker link must never fail the whole export */
      console.warn('[pdf] sticker could not be loaded:', s.url?.slice(0, 80));
    }
  }

  // Make sure all images (stickers, Drive links) are local data URLs before measuring.
  await inlineImages(container);
  for (const band of opts.bands ?? []) {
    const node = document.getElementById(band.nodeId);
    if (node) {
      await inlineImages(node);
      // The header photo / signature heights decide how much space is left on
      // every sheet — measure only AFTER those images have settled, otherwise
      // a too-small band height makes content overflow the page bottom.
      await waitForImages(node);
    }
  }
  // Wait for web fonts to finish loading — text measured mid font-swap has
  // the wrong height, which makes pages overflow in the exported PDF.
  try { await (document as any).fonts?.ready; } catch { /* ignore */ }
  await nextFrame();

  // --- Bands (header/footer) rendered once, reused on every sheet ---
  type Band = { canvas: HTMLCanvasElement; heightCss: number };
  let topBand: Band | null = null;
  let bottomBand: Band | null = null;
  for (const band of opts.bands ?? []) {
    const node = document.getElementById(band.nodeId);
    if (!node) continue;
    const r = await rasterizeNode(node, CONTENT_W_CSS, { prepare: opts.prepareNode });
    if (band.position === 'top') topBand = r;
    else bottomBand = r;
  }

  const bandGapCss = BAND_GAP_CSS;
  // ONE shared formula with the on-screen paginator — identical available
  // height means identical page breaks between preview and exported PDF.
  const availableCss = computeAvailableFlowHeightCss(
    topBand ? topBand.heightCss : 0,
    bottomBand ? bottomBand.heightCss : 0,
  );

  // The site already packs the SAME atomic blocks into these pages; honour
  // that pagination so the PDF matches what the user flipped through on-screen.
  // If an on-screen page still measures taller than one sheet (late-loading
  // images, fonts), its overflow is sliced onto extra sheets — never hidden.
  const pageNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-page]'));
  let pages: MeasuredBlock[][];
  if (pageNodes.length > 0) {
    pages = [];
    for (const pn of pageNodes) {
      // flowIntoPages re-slices any block taller than one printable area and
      // pushes every remaining slice to the NEXT page — data that doesn't fit
      // always continues on a following sheet instead of being clipped away.
      for (const sub of flowIntoPages(measureBlocks(pn), Math.max(availableCss, 100))) {
        pages.push(sub);
      }
    }
    if (pages.length === 0) pages.push([]);
  } else {
    // Fallback path: no pre-paginated structure — measure the raw children at
    // their TRUE height (never trusting flex-shrunk offsetHeight, which hides
    // overflowing content) and flow them across as many sheets as needed.
    const blocks = measureBlocks(container).map((b) => ({ el: b.el, height: measureTrueHeight(b.el) || b.height }));
    if (blocks.length === 0) throw new Error('No content found to export.');
    pages = flowIntoPages(blocks, Math.max(availableCss, 100));
  }

  // Final safety net: if any page's blocks STILL exceed one printable area
  // (e.g. late font swap made measurements stale after packing), re-flow it
  // so nothing spills past the sheet edge or under the footer band.
  pages = pages.flatMap((pg) => {
    const total = pg.reduce((s, b) => s + b.height, 0);
    if (total > availableCss && pg.length > 0) return flowIntoPages(pg, Math.max(availableCss, 100));
    return [pg];
  });

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  // --- Sticker placements across the final sheet count ---
  // Pinned stickers stay on their page; link-only stickers are scattered
  // randomly (deterministically) over ALL pages, exactly like the preview.
  const stickerPlacements: Array<{ img: HTMLImageElement; p: { page: number; xPct: number; yPct: number; sizePct: number; rotate: number } }> = [];
  for (const { img, sticker } of preparedStickers) {
    for (const p of resolveStickerPlacements(sticker, pages.length)) {
      stickerPlacements.push({ img, p });
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const S = PRINT_SCALE;
    let y = MARGIN_CSS * S;

    if (topBand) {
      ctx.drawImage(topBand.canvas, MARGIN_CSS * S, y, CONTENT_W_CSS * S, topBand.heightCss * S);
      y += (topBand.heightCss + bandGapCss) * S;
    }

    for (const b of pages[i]) {
      const bc = await rasterizeBlock(b, opts.prepareNode);
      // Hard guarantee: content is NEVER drawn into the footer band's zone.
      // If a block still reaches past the printable area (stale measurement),
      // only its fitting part is painted here; the re-flow above already put
      // the remainder on a following sheet, so nothing is silently lost.
      const footerTopY = bottomBand
        ? SHEET_H_CSS - MARGIN_CSS - bottomBand.heightCss
        : SHEET_H_CSS - MARGIN_CSS - PAGE_NUMBER_RESERVE_CSS;
      const drawH = Math.min(b.height, Math.max(0, footerTopY - y / S));
      if (drawH > 1) {
        ctx.drawImage(bc, MARGIN_CSS * S, y, CONTENT_W_CSS * S, drawH * S);
      }
      y += b.height * S;
      await wait(0);
    }

    // Stickers for this sheet — drawn ON TOP of everything, exactly like the
    // preview. The bottom-right corner stays free so a sticker can never hide
    // the "Page N of M" stamp.
    const pnBoxX = SHEET_W_CSS - MARGIN_CSS - PAGE_NUMBER_RESERVE_W_CSS;
    const pnBoxY = SHEET_H_CSS - MARGIN_CSS - PAGE_NUMBER_RESERVE_CSS;
    for (const { img, p } of stickerPlacements) {
      if (p.page !== i) continue;
      const wPx = (p.sizePct / 100) * SHEET_W_CSS;
      const hPx = img.naturalWidth && img.naturalHeight ? wPx * (img.naturalHeight / img.naturalWidth) : wPx;
      const overlapsPageNumber =
        p.xPct < ((pnBoxX + wPx) / SHEET_W_CSS) * 100 &&
        p.yPct < ((pnBoxY + hPx) / SHEET_H_CSS) * 100;
      if (!overlapsPageNumber) drawStickerOnSheet(ctx, img, p);
    }

    // Footer band painted LAST so stickers can never cover the signatures.
    if (bottomBand) {
      const by = (SHEET_H_CSS - MARGIN_CSS - bottomBand.heightCss) * S;
      ctx.drawImage(bottomBand.canvas, MARGIN_CSS * S, by, CONTENT_W_CSS * S, bottomBand.heightCss * S);
    }

    // Page number — bottom-right corner of every A4 sheet
    ctx.font = `${Math.round(9 * PRINT_SCALE * (96 / 72))}px Georgia, "Times New Roman", serif`;
    ctx.fillStyle = '#92400e';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`Page ${i + 1} of ${pages.length}`, (SHEET_W_CSS - MARGIN_CSS) * S, (SHEET_H_CSS - MARGIN_CSS * 0.4) * S);

    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, A4_MM.width, A4_MM.height, undefined, 'FAST');
    opts.onPageProgress?.(i + 1, pages.length);
    await nextFrame();
  }

  pdf.save(opts.fileName);
  return pages.length;
}

/** Legacy helper: render ready-made `.a4-page` nodes one-to-one into an A4 PDF. */
export async function exportPagesToA4Pdf(pageSelector: string, fileName: string): Promise<number> {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(pageSelector));
  if (nodes.length === 0) throw new Error('No pages found to export.');

  for (const n of nodes) await inlineImages(n);
  await nextFrame();

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  for (let i = 0; i < nodes.length; i++) {
    const { canvas } = await rasterizeNode(nodes[i], SHEET_W_CSS);
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, A4_MM.width, A4_MM.height, undefined, 'FAST');
    await nextFrame();
  }
  pdf.save(fileName);
  return nodes.length;
}
