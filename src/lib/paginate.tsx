// Splits a linear stream of blocks into fixed-size A4 pages.
// All heights are measured in "page units" where 1 = full printable height of an A4 page,
// so the same layout math works on-site (px) and when rasterizing to PDF.
import type { ReactNode } from 'react';

export interface PageBlock {
  key: string;
  /** Estimated height as a fraction of one printable A4 page height. */
  heightUnits: number;
  render: () => ReactNode;
}

/**
 * Greedy pagination with a safety margin so content never overflows the A4 sheet.
 * `fillLimit` < 1 leaves room for rounding differences between estimate and reality.
 */
export function paginateBlocks(blocks: PageBlock[], fillLimit = 0.97): PageBlock[][] {
  const pages: PageBlock[][] = [];
  let current: PageBlock[] = [];
  let used = 0;

  for (const b of blocks) {
    // Oversized single block gets its own page (content is scaled down via CSS if needed)
    if (used + b.heightUnits > fillLimit && current.length > 0) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(b);
    used += b.heightUnits;
  }
  if (current.length > 0) pages.push(current);
  if (pages.length === 0) pages.push([]);
  return pages;
}

/** Rough height estimator for a text paragraph rendered at diary body size. */
export function estimateTextHeightUnits(text: string, charsPerLine: number, linesPerPageUnit: number): number {
  const words = (text || '').split(/\s+/).filter(Boolean);
  let lines = 1;
  let len = 0;
  for (const w of words) {
    if (len + w.length + 1 > charsPerLine) {
      lines++;
      len = w.length;
    } else {
      len += w.length + 1;
    }
  }
  return Math.max(0.02, lines / linesPerPageUnit);
}
