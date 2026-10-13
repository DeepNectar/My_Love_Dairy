// A4 PDF export for the diary.
// Renders each on-screen A4 page (`.a4-page`) to an image and stitches them
// into a true A4-sized multi-page PDF (jsPDF + html2canvas).
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export const A4_MM = { width: 210, height: 297 } as const;

/** Narrow margins used both on-site and in the exported PDF (in mm). */
export const NARROW_MARGIN_MM = 10;

/**
 * Export every element matching `pageSelector` as one A4 page per element.
 * Returns the number of pages written.
 */
export async function exportPagesToA4Pdf(
  pageSelector: string,
  fileName: string,
): Promise<number> {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(pageSelector));
  if (nodes.length === 0) throw new Error('No pages found to export.');

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  for (let i = 0; i < nodes.length; i++) {
    const canvas = await html2canvas(nodes[i], {
      scale: 2,
      useCORS: true, // allow cross-origin images (sticker links) when CORS headers permit
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const pageW = A4_MM.width;
    const pageH = A4_MM.height;

    // Fit whole page inside A4 while preserving aspect ratio (pages are already A4-shaped)
    const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;

    if (i > 0) pdf.addPage();
    pdf.addImage(imgData, 'PNG', x, y, w, h, undefined, 'FAST');
  }

  pdf.save(fileName);
  return nodes.length;
}
