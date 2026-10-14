import { jsPDF } from "jspdf";
import { loadDataUrlCached } from "./images";
const A4_MM = { width: 210, height: 297 };
const NARROW_MARGIN_MM = 8;
const CSS_PX_PER_MM = 96 / 25.4;
const PRINT_SCALE = 300 / 96;
const SHEET_W_CSS = Math.round(A4_MM.width * CSS_PX_PER_MM);
const SHEET_H_CSS = Math.round(A4_MM.height * CSS_PX_PER_MM);
const MARGIN_CSS = Math.round(NARROW_MARGIN_MM * CSS_PX_PER_MM);
const CANVAS_W = Math.round(SHEET_W_CSS * PRINT_SCALE);
const CANVAS_H = Math.round(SHEET_H_CSS * PRINT_SCALE);
const CONTENT_W_CSS = SHEET_W_CSS - MARGIN_CSS * 2;
const PAGE_NUMBER_RESERVE_CSS = Math.round(10 * CSS_PX_PER_MM);
const PAGE_NUMBER_RESERVE_W_CSS = Math.round(45 * CSS_PX_PER_MM);
const BAND_GAP_CSS = Math.round(2 * CSS_PX_PER_MM);
const FLOW_SAFETY_CSS = 6;
function computeAvailableFlowHeightCss(headerH, footerH) {
  return SHEET_H_CSS - MARGIN_CSS * 2 - (headerH + BAND_GAP_CSS) - (footerH + BAND_GAP_CSS) - PAGE_NUMBER_RESERVE_CSS - FLOW_SAFETY_CSS;
}
function seededRandomFrom(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h << 13;
  h = h >>> 0;
  h ^= h >> 17;
  h ^= h << 5;
  h = h >>> 0;
  return (h >>> 0) / 4294967296;
}
function resolveStickerPlacements(s, totalPages) {
  const T = Math.max(1, totalPages);
  const size = s.sizePct ?? 11;
  const baseRotate = s.rotate ?? -4;
  const mk = (page, q) => ({
    page,
    // keep stickers fully inside the sheet, clear of the 8mm margins & corner number
    xPct: s.xPct ?? 6 + q * (86 - size),
    // 6% … 92%-size
    yPct: s.yPct ?? 14 + q * 7919 % 1e3 / 1e3 * (70 - size * 0.5),
    // 14% … ~84%
    sizePct: size,
    rotate: s.rotate ?? Math.round((baseRotate + q * 104729 % 13 - 6) * 10) / 10
  });
  if (typeof s.page === "number") {
    if (s.page === -1) return [mk(Math.floor(seededRandomFrom(`${s.id}:page`) * T), seededRandomFrom(`${s.id}:pos`))];
    return [mk(Math.max(0, Math.min(T - 1, s.page)), seededRandomFrom(`${s.id}:pos`))];
  }
  return Array.from({ length: T }, (_, p) => mk(p, seededRandomFrom(`${s.id}:${p}`)));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function nextFrame() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await wait(0);
}
// Per-export resolved cache: one URL is fetched ONCE per export run instead of
// once per page — the header photo & both footer signatures used to be re-fetched
// for every single A4 page, which made saving the PDF extremely slow.
let runCache = null;
function beginImageRun() {
  runCache = /* @__PURE__ */ new Map();
}
async function toDataUrlAnyForm(ref) {
  const cache = runCache ?? loadDataUrlCached(ref);
  if (!(cache instanceof Promise)) {
    if (cache.has(ref)) return cache.get(ref);
    const p = loadDataUrlCached(ref).catch((err) => {
      cache.delete(ref);
      throw err;
    });
    cache.set(ref, p);
    return p;
  }
  return cache;
}
async function hydrateStickerImg(img, url) {
  const dataUrl = await toDataUrlAnyForm(url);
  await new Promise((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.removeAttribute("crossorigin");
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    img.src = dataUrl;
  });
}
async function inlineImages(root) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) return;
      try {
        await hydrateStickerImg(img, src);
      } catch {
        // Keep the original src as a last resort: if it already loaded in the
        // browser cache, html2canvas-style SVG rasterisation can still use it.
      }
    })
  );
}
function pinImageSizes(node, clone) {
  const origImgs = Array.from(node.querySelectorAll("img"));
  const cloneImgs = Array.from(clone.querySelectorAll("img"));
  const n = Math.min(origImgs.length, cloneImgs.length);
  for (let i = 0; i < n; i++) {
    const o = origImgs[i];
    const c = cloneImgs[i];
    const w = o.offsetWidth || o.clientWidth || Number(o.getAttribute("width")) || 0;
    const h = o.offsetHeight || o.clientHeight || Number(o.getAttribute("height")) || 0;
    if (w > 0) {
      c.style.width = `${Math.round(w)}px`;
      c.style.maxWidth = `${Math.round(w)}px`;
    }
    if (h > 0) {
      c.style.height = `${Math.round(h)}px`;
      c.style.maxHeight = `${Math.round(h)}px`;
    }
    const fit = getComputedStyle(o).objectFit;
    if (fit) c.style.objectFit = fit;
  }
}
function measureBlocks(container) {
  const out = [];
  for (const child of Array.from(container.children)) {
    const h = child.offsetHeight || child.scrollHeight;
    if (h > 0) out.push({ el: child, height: h });
  }
  return out;
}
function sliceOversized(block, maxH) {
  const out = [];
  const overlap = Math.round(6 * CSS_PX_PER_MM);
  const step = Math.max(1, maxH - overlap);
  let offset = 0;
  while (offset < block.height) {
    const sliceH = Math.min(maxH, block.height - offset);
    const clone = block.el.cloneNode(true);
    clone.style.position = "relative";
    clone.style.top = `-${offset}px`;
    const wrapper = document.createElement("div");
    wrapper.style.width = `${CONTENT_W_CSS}px`;
    wrapper.style.height = `${sliceH}px`;
    wrapper.style.overflow = "hidden";
    wrapper.appendChild(clone);
    out.push({ el: wrapper, height: sliceH });
    offset += step;
  }
  return out.length ? out : [block];
}
function fitSlicedBlock(el, targetH, maxExtra) {
  if (!el.style || el.style.top === "") return;
  let currentTop = parseFloat(el.style.top) || 0;
  const origTop = currentTop;
  let guard = 0;
  while (guard++ < 60 && el.scrollHeight > targetH + 1 && -currentTop < maxExtra) {
    currentTop -= Math.ceil(el.scrollHeight - targetH);
    el.style.top = `${currentTop}px`;
  }
  if (el.firstElementChild instanceof HTMLElement && el.firstElementChild.offsetHeight < targetH) {
    currentTop = origTop;
    el.style.top = `${currentTop}px`;
  }
}
function flowIntoPages(blocks, availableHeightCss) {
  const maxH = availableHeightCss;
  const pages = [];
  let current = [];
  let used = 0;
  const pushPage = () => {
    if (current.length) {
      pages.push(current);
      current = [];
      used = 0;
    }
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
const XML_ATTR_ESC = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" };
const escapeAttr = (s) => s.replace(/[&"<>]/g, (c) => XML_ATTR_ESC[c]);
const escapeText = (s) => s.replace(/[&<>]/g, (c) => XML_ATTR_ESC[c] ?? c);
const VOID_TAGS = /* @__PURE__ */ new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
function toXhtml(el) {
  const ser = (n) => {
    if (n.nodeType === 3) return escapeText(n.textContent || "");
    if (n.nodeType !== 1) return "";
    const e = n;
    const tag = e.tagName.toLowerCase();
    let open = `<${tag}`;
    for (const attr of Array.from(e.attributes)) {
      open += ` ${attr.name}="${escapeAttr(attr.value)}"`;
    }
    if (VOID_TAGS.has(tag)) return `${open}/>`;
    open += ">";
    let inner = "";
    for (const c of Array.from(e.childNodes)) inner += ser(c);
    return `${open}${inner}</${tag}>`;
  };
  return ser(el);
}
function inlineComputedStyles(root) {
  const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const n of nodes) {
    const cs = getComputedStyle(n);
    let style = "";
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      const val = cs.getPropertyValue(prop);
      if (!val) continue;
      if (prop.startsWith("-webkit-text-") || prop === "d" || prop.startsWith("--")) continue;
      style += `${prop}:${val};`;
    }
    n.setAttribute("style", style);
  }
  return toXhtml(root);
}
async function rasterizeNode(el, widthCss, opts) {
  const isSlice = typeof opts?.heightOverride === "number";
  const heightCss = isSlice ? opts.heightOverride : el.offsetHeight || el.scrollHeight;
  const rawClone = opts?.prepare ? opts.prepare(el) : el.cloneNode(true);
  const clone = rawClone;
  // Make sure every <img> inside the clone carries an inlined data: URL — SVG
  // foreignObject rasterisation cannot load remote/CORS images, so without this
  // step header photos, footer signatures and sticker pictures silently vanish
  // from the exported PDF.
  await inlineImages(clone);
  pinImageSizes(el, clone);
  clone.style.width = `${widthCss}px`;
  if (isSlice) {
    clone.style.height = `${heightCss}px`;
    clone.style.maxHeight = `${heightCss}px`;
    clone.style.overflow = "hidden";
    clone.style.boxSizing = "border-box";
    clone.style.position = "relative";
    clone.style.transform = "none";
    clone.style.margin = "0";
    fitSlicedBlock(clone, heightCss, Math.round(15 * CSS_PX_PER_MM));
  } else {
    clone.style.height = "auto";
    clone.style.maxHeight = "none";
    clone.style.position = "static";
    clone.style.transform = "none";
    clone.style.margin = "0";
    clone.style.overflow = "visible";
  }
  const inner = inlineComputedStyles(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthCss}" height="${heightCss}" viewBox="0 0 ${widthCss} ${heightCss}"><foreignObject width="${widthCss}" height="${heightCss}"><div xmlns="http://www.w3.org/1999/xhtml">${inner}</div></foreignObject></svg>`;
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG snapshot failed to decode."));
      img.src = url;
    });
  } catch (err) {
    console.error("[pdf] rasterization failed for node:", el.id || el.className, err);
    throw err;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthCss * PRINT_SCALE);
  canvas.height = Math.max(1, Math.round(heightCss * PRINT_SCALE));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, heightCss };
}
async function rasterizeBlock(b, prepare) {
  const isSlice = b.el.style.height !== "" && parseFloat(b.el.style.top || "") < 0;
  const { canvas } = await rasterizeNode(
    b.el,
    CONTENT_W_CSS,
    isSlice ? { heightOverride: b.height, prepare } : { prepare }
  );
  return canvas;
}
function measureTrueHeight(el) {
  const prevFlex = el.style.flex;
  const prevMinH = el.style.minHeight;
  const prevOverflow = el.style.overflow;
  el.style.flex = "0 0 auto";
  el.style.minHeight = "0";
  el.style.overflow = "visible";
  const h = Math.max(el.scrollHeight, el.offsetHeight);
  el.style.flex = prevFlex;
  el.style.minHeight = prevMinH;
  el.style.overflow = prevOverflow;
  return h;
}
function drawStickerOnSheet(ctx, img, p) {
  const S = PRINT_SCALE;
  const wPx = p.sizePct / 100 * SHEET_W_CSS * S;
  if (!img.naturalWidth || !img.naturalHeight || wPx < 4) return;
  const hPx = wPx * (img.naturalHeight / img.naturalWidth);
  const cx = p.xPct / 100 * SHEET_W_CSS * S + wPx / 2;
  const cy = p.yPct / 100 * SHEET_H_CSS * S + hPx / 2;
  const pad = Math.max(3, wPx * 0.05);
  const bottomPad = pad * 2.2;
  const rad = p.rotate * Math.PI / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  ctx.shadowColor = "rgba(60, 30, 10, 0.35)";
  ctx.shadowBlur = pad * 2.2;
  ctx.shadowOffsetX = pad * 0.7;
  ctx.shadowOffsetY = pad * 1.1;
  ctx.fillStyle = "#ffffff";
  roundRectPath(ctx, -wPx / 2 - pad, -hPx / 2 - pad, wPx + pad * 2, hPx + pad + bottomPad, pad * 0.8);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "rgba(180, 83, 9, 0.35)";
  ctx.lineWidth = Math.max(1, pad * 0.25);
  roundRectPath(ctx, -wPx / 2 - pad, -hPx / 2 - pad, wPx + pad * 2, hPx + pad + bottomPad, pad * 0.8);
  ctx.stroke();
  ctx.drawImage(img, -wPx / 2, -hPx / 2, wPx, hPx);
  ctx.restore();
}
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
async function waitForImages(root) {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) => new Promise((resolve) => {
        if (img.complete && img.naturalWidth > 0) return resolve();
        img.onload = () => resolve();
        img.onerror = () => resolve();
      })
    )
  );
}
const SHEET_PX_W = Math.round(210 * CSS_PX_PER_MM);
const SHEET_PX_H = Math.round(297 * CSS_PX_PER_MM);
async function renderSheetNode(node, opts) {
  beginImageRun();
  await inlineImages(node);
  await waitForImages(node);
  const prevTransform = node.style.transform;
  const prevAnimation = node.style.animation;
  node.style.transform = "none";
  node.style.animation = "none";
  try {
    const rawClone = opts?.prepare ? opts.prepare(node) : node.cloneNode(true);
    const clone = rawClone;
    await inlineImages(clone);
    pinImageSizes(node, clone);
    // Render the requested page's content directly from the flow data instead of
    // forcing a React re-render + waiting for it to paint (huge speed-up and no
    // chance of capturing the wrong/previous page).
    if (typeof opts?.pageIndex === "number" && Array.isArray(opts.flowPages)) {
      const area = clone.querySelector(".a4-print-area");
      if (area) {
        area.innerHTML = "";
        for (const b of opts.flowPages[opts.pageIndex] ?? []) {
          if (b.sliceTop !== void 0) {
            const outer = document.createElement("div");
            outer.style.height = `${b.height}px`;
            outer.style.overflow = "hidden";
            const innerDiv = document.createElement("div");
            innerDiv.style.position = "relative";
            innerDiv.style.top = `-${b.sliceTop}px`;
            innerDiv.innerHTML = b.html;
            outer.appendChild(innerDiv);
            area.appendChild(outer);
          } else {
            const d = document.createElement("div");
            d.innerHTML = b.html;
            area.appendChild(d);
          }
        }
      }
      const pn = clone.querySelector(".a4-page-number");
      if (pn) {
        pn.textContent = `Page ${opts.pageIndex + 1} of ${Math.max(opts.flowPages.length, 1)}`;
      }
    }
    // Hard-coded stickers: draw them on the cloned sheet at their resolved
    // positions so the exported PDF matches the on-screen preview exactly.
    if (Array.isArray(opts?.stickerPlacements) && opts.stickerPlacements.length) {
      const host = document.createElement("div");
      host.style.position = "absolute";
      host.style.inset = "0";
      host.style.pointerEvents = "none";
      host.style.zIndex = "3";
      for (const pl of opts.stickerPlacements) {
        let dataUrl = null;
        try {
          dataUrl = await toDataUrlAnyForm(pl.url);
        } catch {
          console.warn("[pdf] sticker could not be inlined:", String(pl.url).slice(0, 80));
        }
        if (!dataUrl) continue;
        const wrap = document.createElement("div");
        wrap.style.position = "absolute";
        wrap.style.left = `${pl.xPct}%`;
        wrap.style.top = `${pl.yPct}%`;
        wrap.style.width = `${pl.sizePct}%`;
        wrap.style.transform = `rotate(${pl.rotate}deg)`;
        const im = document.createElement("img");
        im.src = dataUrl;
        im.style.display = "block";
        im.style.width = "100%";
        im.style.height = "auto";
        im.style.border = "3px solid #fff";
        im.style.borderRadius = "8px";
        im.style.boxShadow = "0 0 0 1px rgba(180, 83, 9, 0.35), 0 3px 6px rgba(0,0,0,0.3)";
        wrap.appendChild(im);
        host.appendChild(wrap);
      }
      clone.appendChild(host);
    }
    clone.style.width = `${SHEET_PX_W}px`;
    clone.style.height = `${SHEET_PX_H}px`;
    clone.style.boxSizing = "border-box";
    clone.style.position = "relative";
    clone.style.left = "0";
    clone.style.top = "0";
    clone.style.transform = "none";
    clone.style.animation = "none";
    clone.style.margin = "0";
    const inner = inlineComputedStyles(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_PX_W}" height="${SHEET_PX_H}" viewBox="0 0 ${SHEET_PX_W} ${SHEET_PX_H}"><foreignObject width="${SHEET_PX_W}" height="${SHEET_PX_H}"><div xmlns="http://www.w3.org/1999/xhtml">${inner}</div></foreignObject></svg>`;
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Sheet snapshot failed to decode."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    node.style.transform = prevTransform;
    node.style.animation = prevAnimation;
  }
}
async function exportDiaryToA4Pdf(opts) {
  if (opts.pages && opts.pages.length > 0) {
    const pdf2 = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    for (let i = 0; i < opts.pages.length; i++) {
      if (i > 0) pdf2.addPage();
      pdf2.addImage(opts.pages[i].canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, A4_MM.width, A4_MM.height, void 0, "FAST");
      opts.onPageProgress?.(i + 1, opts.pages.length);
      await nextFrame();
    }
    pdf2.save(opts.fileName);
    return opts.pages.length;
  }
  const container = document.querySelector(opts.blocksSelector);
  if (!container) throw new Error("Nothing to export yet \u2014 add some entries first.");
  beginImageRun();
  const preparedStickers = [];
  for (const s of opts.stickers ?? []) {
    try {
      const dataUrl = await toDataUrlAnyForm(s.url);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("sticker decode failed"));
        img.src = dataUrl;
      });
      preparedStickers.push({ img, sticker: s });
    } catch {
      console.warn("[pdf] sticker could not be loaded:", s.url?.slice(0, 80));
    }
  }
  await inlineImages(container);
  for (const band of opts.bands ?? []) {
    const node = document.getElementById(band.nodeId);
    if (node) {
      await inlineImages(node);
      await waitForImages(node);
    }
  }
  try {
    await document.fonts?.ready;
  } catch {
  }
  await nextFrame();
  let topBand = null;
  let bottomBand = null;
  for (const band of opts.bands ?? []) {
    const node = document.getElementById(band.nodeId);
    if (!node) continue;
    const r = await rasterizeNode(node, CONTENT_W_CSS, { prepare: opts.prepareNode });
    if (band.position === "top") topBand = r;
    else bottomBand = r;
  }
  const bandGapCss = BAND_GAP_CSS;
  const availableCss = computeAvailableFlowHeightCss(
    topBand ? topBand.heightCss : 0,
    bottomBand ? bottomBand.heightCss : 0
  );
  const pageNodes = Array.from(container.querySelectorAll("[data-page]"));
  let pages;
  if (pageNodes.length > 0) {
    pages = [];
    for (const pn of pageNodes) {
      for (const sub of flowIntoPages(measureBlocks(pn), Math.max(availableCss, 100))) {
        pages.push(sub);
      }
    }
    if (pages.length === 0) pages.push([]);
  } else {
    const blocks = measureBlocks(container).map((b) => ({ el: b.el, height: measureTrueHeight(b.el) || b.height }));
    if (blocks.length === 0) throw new Error("No content found to export.");
    pages = flowIntoPages(blocks, Math.max(availableCss, 100));
  }
  pages = pages.flatMap((pg) => {
    const total = pg.reduce((s, b) => s + b.height, 0);
    if (total > availableCss && pg.length > 0) return flowIntoPages(pg, Math.max(availableCss, 100));
    return [pg];
  });
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const stickerPlacements = [];
  for (const { img, sticker } of preparedStickers) {
    for (const p of resolveStickerPlacements(sticker, pages.length)) {
      stickerPlacements.push({ img, p });
    }
  }
  for (let i = 0; i < pages.length; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const S = PRINT_SCALE;
    let y = MARGIN_CSS * S;
    if (topBand) {
      ctx.drawImage(topBand.canvas, MARGIN_CSS * S, y, CONTENT_W_CSS * S, topBand.heightCss * S);
      y += (topBand.heightCss + bandGapCss) * S;
    }
    for (const b of pages[i]) {
      const bc = await rasterizeBlock(b, opts.prepareNode);
      const footerTopY = bottomBand ? SHEET_H_CSS - MARGIN_CSS - bottomBand.heightCss : SHEET_H_CSS - MARGIN_CSS - PAGE_NUMBER_RESERVE_CSS;
      const drawH = Math.min(b.height, Math.max(0, footerTopY - y / S));
      if (drawH > 1) {
        ctx.drawImage(bc, MARGIN_CSS * S, y, CONTENT_W_CSS * S, drawH * S);
      }
      y += b.height * S;
      await wait(0);
    }
    const pnBoxX = SHEET_W_CSS - MARGIN_CSS - PAGE_NUMBER_RESERVE_W_CSS;
    const pnBoxY = SHEET_H_CSS - MARGIN_CSS - PAGE_NUMBER_RESERVE_CSS;
    for (const { img, p } of stickerPlacements) {
      if (p.page !== i) continue;
      const wPx = p.sizePct / 100 * SHEET_W_CSS;
      const hPx = img.naturalWidth && img.naturalHeight ? wPx * (img.naturalHeight / img.naturalWidth) : wPx;
      const overlapsPageNumber = p.xPct < (pnBoxX + wPx) / SHEET_W_CSS * 100 && p.yPct < (pnBoxY + hPx) / SHEET_H_CSS * 100;
      if (!overlapsPageNumber) drawStickerOnSheet(ctx, img, p);
    }
    if (bottomBand) {
      const by = (SHEET_H_CSS - MARGIN_CSS - bottomBand.heightCss) * S;
      ctx.drawImage(bottomBand.canvas, MARGIN_CSS * S, by, CONTENT_W_CSS * S, bottomBand.heightCss * S);
    }
    ctx.font = `${Math.round(9 * PRINT_SCALE * (96 / 72))}px Georgia, "Times New Roman", serif`;
    ctx.fillStyle = "#92400e";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`Page ${i + 1} of ${pages.length}`, (SHEET_W_CSS - MARGIN_CSS) * S, (SHEET_H_CSS - MARGIN_CSS * 0.4) * S);
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, A4_MM.width, A4_MM.height, void 0, "FAST");
    opts.onPageProgress?.(i + 1, pages.length);
    await nextFrame();
  }
  pdf.save(opts.fileName);
  return pages.length;
}
async function exportPagesToA4Pdf(pageSelector, fileName) {
  const nodes = Array.from(document.querySelectorAll(pageSelector));
  if (nodes.length === 0) throw new Error("No pages found to export.");
  beginImageRun();
  for (const n of nodes) await inlineImages(n);
  await nextFrame();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  for (let i = 0; i < nodes.length; i++) {
    const { canvas } = await rasterizeNode(nodes[i], SHEET_W_CSS);
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, A4_MM.width, A4_MM.height, void 0, "FAST");
    await nextFrame();
  }
  pdf.save(fileName);
  return nodes.length;
}
export {
  A4_MM,
  BAND_GAP_CSS,
  CONTENT_W_CSS,
  CSS_PX_PER_MM,
  FLOW_SAFETY_CSS,
  MARGIN_CSS,
  NARROW_MARGIN_MM,
  PAGE_NUMBER_RESERVE_CSS,
  PAGE_NUMBER_RESERVE_W_CSS,
  SHEET_H_CSS,
  SHEET_W_CSS,
  computeAvailableFlowHeightCss,
  exportDiaryToA4Pdf,
  exportPagesToA4Pdf,
  flowIntoPages,
  renderSheetNode,
  resolveStickerPlacements,
  seededRandomFrom
};
