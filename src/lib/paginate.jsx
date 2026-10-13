function paginateBlocks(blocks, fillLimit = 0.97) {
  const pages = [];
  let current = [];
  let used = 0;
  for (const b of blocks) {
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
function estimateTextHeightUnits(text, charsPerLine, linesPerPageUnit) {
  const words = (text || "").split(/\s+/).filter(Boolean);
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
export {
  estimateTextHeightUnits,
  paginateBlocks
};
