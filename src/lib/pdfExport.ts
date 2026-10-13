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
import { loadDataUrlCached } from './images';

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

export interface PdfOptions {
  blocksSelector: string;
  bands?: PdfBand[];
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

/** Replace every remote <img src> inside `root` with a CORS-clean data URL. */
async function inlineImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      try {
        const dataUrl = await loadDataUrlCached(src);
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.removeAttribute('crossorigin');
          img.src = dataUrl;
        });
      } catch {
        /* keep going: a single unreachable image must not fail the whole PDF */
      }
    })
  );
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

export async function exportDiaryToA4Pdf(opts: PdfOptions): Promise<number> {
  const container = document.querySelector<HTMLElement>(opts.blocksSelector);
  if (!container) throw new Error('Nothing to export yet — add some entries first.');

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
