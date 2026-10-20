import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from 'pdf-lib';
import type { Page, SourceFile } from './types';
import { hasObjects, overlayTextRuns, overlayToCanvas } from './overlay';
import { totalRot, viewSize } from './render';
import { canvasToPngBytes, hexToRgb01 } from './util';

/** Overlay resolution in pixels per point (3 ≈ 216 dpi). */
const OVERLAY_SCALE = 3;

/**
 * Builds the final PDF. Original page content stays vector; edits and drawings
 * are flattened into a transparent image placed on top of each page.
 */
export async function exportPdf(
  pages: Page[],
  files: Record<string, SourceFile>,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const sources = new Map<string, PDFDocument>();
  let textFont: PDFFont | null = null;

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length);
    const pg = pages[i];
    let page;
    if (pg.source.kind === 'pdf') {
      let src = sources.get(pg.source.fileId);
      if (!src) {
        src = await PDFDocument.load(files[pg.source.fileId].bytes, { ignoreEncryption: true });
        sources.set(pg.source.fileId, src);
      }
      [page] = await out.copyPages(src, [pg.source.index]);
      out.addPage(page);
    } else {
      page = out.addPage([pg.width, pg.height]);
    }

    const r = totalRot(pg);
    page.setRotation(degrees(r));
    const box = page.getCropBox();

    if (pg.source.kind === 'blank' && pg.bgColor) {
      page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: rgb(...hexToRgb01(pg.bgColor)) });
    }

    if (hasObjects(pg.overlay)) {
      const { w: vw, h: vh } = viewSize(pg);
      const canvas = await overlayToCanvas(pg.overlay, vw, vh, OVERLAY_SCALE);
      const img = await out.embedPng(await canvasToPngBytes(canvas));
      // The viewer rotates the page clockwise by `r`, so draw the image rotated
      // counter-clockwise by `r` from the matching corner to make it appear upright.
      const W = box.width;
      const H = box.height;
      const anchor = { 0: [0, 0], 90: [W, 0], 180: [W, H], 270: [0, H] }[r];
      page.drawImage(img, {
        x: box.x + anchor[0],
        y: box.y + anchor[1],
        width: vw,
        height: vh,
        rotate: degrees(r),
      });

      // Invisible real text on top of the picture so edited/added text stays searchable and copyable.
      const runs = await overlayTextRuns(pg.overlay, vw, vh);
      if (runs.length) {
        textFont ??= await out.embedFont(StandardFonts.Helvetica);
        const rad = (r * Math.PI) / 180;
        for (const run of runs) {
          const text = winAnsi(run.text);
          if (!text.trim()) continue;
          const natural = textFont.widthOfTextAtSize(text, run.size);
          const size = natural > 0 ? run.size * Math.min(2, Math.max(0.5, run.width / natural)) : run.size;
          const u = run.x;
          const v = vh - run.y;
          page.drawText(text, {
            x: box.x + anchor[0] + u * Math.cos(rad) - v * Math.sin(rad),
            y: box.y + anchor[1] + u * Math.sin(rad) + v * Math.cos(rad),
            size,
            font: textFont,
            rotate: degrees(r - run.angle),
            opacity: 0,
          });
        }
      }
    }
  }
  onProgress?.(pages.length, pages.length);
  return out.save();
}

/** Keeps only characters the built-in Helvetica (WinAnsi) can encode. */
function winAnsi(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
}

/** Fast merge straight from files, without opening them in the editor. */
export async function mergePdfFiles(files: File[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return out.save();
}
