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

const CSS_PX_PER_MM = 96 / 25.4;          // browser CSS pixel size
const PRINT_SCALE = 300 / 96;             // canvas pixels per CSS pixel (≈300 DPI output)

/** Sheet size in CSS pixels (what the DOM is laid out in). */
export const SHEET_W_CSS = Math.round(A4_MM.width * CSS_PX_PER_MM);  // ~794
export const SHEET_H_CSS = Math.round(A4_MM.height * CSS_PX_PER_MM); // ~1123
export const MARGIN_CSS = Math.round(NARROW_MARGIN_MM * CSS_PX_PER_MM);

const CANVAS_W = Math.round(SHEET_W_CSS * PRINT_SCALE);
const CANVAS_H = Math.round(SHEET_H_CSS * PRINT_SCALE);

/** Usable content area inside one sheet (CSS px), leaving room for the page number. */
export const CONTENT_W_CSS = SHEET_W_CSS - MARGIN_CSS * 2;
export const PAGE_NUMBER_RESERVE_CSS = Math.round(12 * CSS_PX_PER_MM);

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

/** Break an oversized block into page-sized chunks using its direct children. */
function splitOversized(block: MeasuredBlock, maxH: number): MeasuredBlock[][] {
  const kids = Array.from(block.el.children) as HTMLElement[];
  if (kids.length <= 1) return [[block]];
  const chunks: MeasuredBlock[][] = [];
  let current: MeasuredBlock[] = [];
  let h = 0;
  for (const kid of kids) {
    const kh = kid.offsetHeight || kid.scrollHeight;
    if (h + kh > maxH && current.length > 0) {
      chunks.push(current);
      current = [];
      h = 0;
    }
    current.push({ el: kid, height: kh });
    h += kh;
  }
  if (current.length) chunks.push(current);
  return chunks;
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
      for (const part of splitOversized(b, maxH)) {
        const ph = part.reduce((a, x) => a + x.height, 0);
        if (used + ph > maxH) pushPage();
        current.push(...part);
        used += ph;
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
async function rasterizeNode(el: HTMLElement, widthCss: number): Promise<{ canvas: HTMLCanvasElement; heightCss: number }> {
  const heightCss = el.offsetHeight || el.scrollHeight;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.width = `${widthCss}px`;
  clone.style.height = 'auto';
  clone.style.maxHeight = 'none';
  clone.style.position = 'static';
  clone.style.transform = 'none';
  clone.style.margin = '0';
  clone.style.overflow = 'visible';

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
  canvas.height = Math.max(1, Math.round(heightCss * PRINT_SCALE));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, heightCss };
}

/** Rasterize a single content block straight from the live DOM node. */
async function rasterizeBlock(b: MeasuredBlock): Promise<HTMLCanvasElement> {
  const { canvas } = await rasterizeNode(b.el, CONTENT_W_CSS);
  return canvas;
}

export async function exportDiaryToA4Pdf(opts: PdfOptions): Promise<number> {
  const container = document.querySelector<HTMLElement>(opts.blocksSelector);
  if (!container) throw new Error('Nothing to export yet — add some entries first.');

  // Make sure all images (stickers, Drive links) are local data URLs before measuring.
  await inlineImages(container);
  for (const band of opts.bands ?? []) {
    const node = document.getElementById(band.nodeId);
    if (node) await inlineImages(node);
  }
  await nextFrame();

  // --- Bands (header/footer) rendered once, reused on every sheet ---
  type Band = { canvas: HTMLCanvasElement; heightCss: number };
  let topBand: Band | null = null;
  let bottomBand: Band | null = null;
  for (const band of opts.bands ?? []) {
    const node = document.getElementById(band.nodeId);
    if (!node) continue;
    const r = await rasterizeNode(node, CONTENT_W_CSS);
    if (band.position === 'top') topBand = r;
    else bottomBand = r;
  }

  const bandGapCss = Math.round(2 * CSS_PX_PER_MM);
  const topUsed = topBand ? topBand.heightCss + bandGapCss : 0;
  const bottomUsed = (bottomBand ? bottomBand.heightCss + bandGapCss : 0) + PAGE_NUMBER_RESERVE_CSS;
  const availableCss = SHEET_H_CSS - MARGIN_CSS * 2 - topUsed - bottomUsed;

  // The site already packs the SAME atomic blocks into these pages; honour
  // that pagination so the PDF matches what the user flipped through on-screen.
  const pageNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-page]'));
  let pages: MeasuredBlock[][];
  if (pageNodes.length > 0) {
    pages = [];
    for (const pn of pageNodes) {
      const blocks = measureBlocks(pn);
      // safety net: if a page somehow overflows, split it across sheets
      for (const part of flowIntoPages(blocks, Math.max(availableCss, 100))) pages.push(part);
    }
    if (pages.length === 0) pages.push([]);
  } else {
    const blocks = measureBlocks(container);
    if (blocks.length === 0) throw new Error('No content found to export.');
    pages = flowIntoPages(blocks, Math.max(availableCss, 100));
  }

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
      const bc = await rasterizeBlock(b);
      ctx.drawImage(bc, MARGIN_CSS * S, y, CONTENT_W_CSS * S, b.height * S);
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
