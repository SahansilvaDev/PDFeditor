import { Document, ImageRun, Packer, PageOrientation, Paragraph, TextRun, type ISectionOptions } from 'docx';
import type { Page, SourceFile } from './types';
import { renderComposite, viewSize } from './render';
import { getTextItems } from './text';
import { canvasToPngBytes } from './util';

export type DocxMode = 'layout' | 'text';

const PT_TO_TWIP = 20;
const PT_TO_PX = 96 / 72;

function pageSize(wPt: number, hPt: number) {
  const w = Math.round(wPt * PT_TO_TWIP);
  const h = Math.round(hPt * PT_TO_TWIP);
  // docx swaps width/height for landscape, so pass the portrait dimensions.
  return w > h
    ? { width: h, height: w, orientation: PageOrientation.LANDSCAPE }
    : { width: w, height: h, orientation: PageOrientation.PORTRAIT };
}

interface Line {
  y: number;
  x: number;
  end: number;
  text: string;
  size: number;
  bold: boolean;
}

/**
 * Axis-aligned box of a serialised fabric object (origin left/top), expressed in the
 * page's orientation before the user rotated it, so text reads left-to-right again.
 */
function objectBox(o: any, page: Page) {
  const w = o.width * (o.scaleX ?? 1);
  const h = o.height * (o.scaleY ?? 1);
  const a = ((o.angle ?? 0) * Math.PI) / 180;
  const cx = o.left + (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a);
  const cy = o.top + (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
  const { w: vw, h: vh } = viewSize(page);
  const r = ((page.rotation % 360) + 360) % 360;
  const c =
    r === 90 ? { x: cy, y: vw - cx } : r === 180 ? { x: vw - cx, y: vh - cy } : r === 270 ? { x: vh - cy, y: cx } : { x: cx, y: cy };
  const upright = Math.round((((o.angle ?? 0) - r) % 360 + 360) % 360 / 90) % 2 === 0;
  const bw = upright ? w : h;
  const bh = upright ? h : w;
  return { x0: c.x - bw / 2, y0: c.y - bh / 2, x1: c.x + bw / 2, y1: c.y + bh / 2 };
}

/** Collects the text of a page (original PDF text + text added in the editor) as lines. */
async function pageLines(page: Page, files: Record<string, SourceFile>): Promise<Line[]> {
  const objects: any[] = page.overlay?.objects ?? [];
  const covers = objects.filter((o) => o.pdfeRole === 'whiteout').map((o) => objectBox(o, page));
  const hidden = (x: number, y: number) => covers.some((c) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);

  const raw: Line[] = [];
  // Read the PDF text without the editor rotation so lines come out in reading order.
  for (const it of await getTextItems({ ...page, rotation: 0 }, files)) {
    const cy = it.baseline - it.size * 0.35;
    if (hidden(it.x + it.w / 2, cy)) continue;
    raw.push({ y: it.baseline, x: it.x, end: it.x + it.w, text: it.str, size: it.size, bold: false });
  }
  for (const o of objects) {
    if (!String(o.type).toLowerCase().includes('text') || !o.text) continue;
    const size = (o.fontSize ?? 16) * (o.scaleY ?? 1);
    const box = objectBox(o, page);
    String(o.text)
      .split('\n')
      .forEach((t: string, i: number) => {
        if (!t.trim()) return;
        const y = box.y0 + size * 0.88 + i * size * (o.lineHeight ?? 1.16) * 1.13;
        raw.push({ y, x: box.x0, end: box.x0 + t.length * size * 0.5, text: t, size, bold: o.fontWeight === 'bold' });
      });
  }

  raw.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const r of raw) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(r.y - last.y) < Math.max(r.size, last.size) * 0.4) {
      const gap = r.x - last.end;
      const space = gap > r.size * 0.15 && !last.text.endsWith(' ') && !r.text.startsWith(' ');
      last.text += (space ? ' ' : '') + r.text;
      last.end = Math.max(last.end, r.end);
      last.size = Math.max(last.size, r.size);
      last.bold ||= r.bold;
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

/** Joins wrapped lines back into paragraphs. */
function toParagraphs(lines: Line[]) {
  const paras: { text: string; size: number; bold: boolean }[] = [];
  let prev: Line | null = null;
  for (const l of lines) {
    const cur = paras[paras.length - 1];
    const continues =
      prev &&
      cur &&
      Math.abs(l.size - prev.size) < 1 &&
      l.y - prev.y < prev.size * 1.6 &&
      prev.text.length > 45 &&
      !/[.:!?]$/.test(prev.text.trim());
    if (continues && cur) cur.text += (cur.text.endsWith('-') ? '' : ' ') + l.text.trim();
    else paras.push({ text: l.text.trim(), size: l.size, bold: l.bold });
    prev = l;
  }
  return paras;
}

export async function exportDocx(
  pages: Page[],
  files: Record<string, SourceFile>,
  mode: DocxMode,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const sections: ISectionOptions[] = [];

  if (mode === 'layout') {
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i, pages.length);
      const pg = pages[i];
      const { w, h } = viewSize(pg);
      const canvas = await renderComposite(pg, files, 2);
      const data = await canvasToPngBytes(canvas);
      sections.push({
        properties: {
          page: {
            size: pageSize(w, h),
            margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 },
          },
        },
        children: [
          new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [
              new ImageRun({
                type: 'png',
                data,
                // Slightly smaller than the page so Word never pushes it onto a new page.
                transformation: { width: Math.floor(w * PT_TO_PX * 0.995), height: Math.floor(h * PT_TO_PX * 0.985) },
              }),
            ],
          }),
        ],
      });
    }
  } else {
    const first = pages[0] ? viewSize(pages[0]) : { w: 595.28, h: 841.89 };
    const children: Paragraph[] = [];
    for (let i = 0; i < pages.length; i++) {
      onProgress?.(i, pages.length);
      const paras = toParagraphs(await pageLines(pages[i], files));
      if (!paras.length) paras.push({ text: '', size: 11, bold: false });
      paras.forEach((p, j) =>
        children.push(
          new Paragraph({
            pageBreakBefore: i > 0 && j === 0,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: p.text,
                size: Math.max(12, Math.round(p.size * 2)),
                bold: p.bold || p.size >= 18,
              }),
            ],
          }),
        ),
      );
    }
    sections.push({
      properties: {
        page: { size: pageSize(first.w, first.h), margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      children,
    });
  }

  onProgress?.(pages.length, pages.length);
  return Packer.toBlob(new Document({ creator: 'PDF Studio', sections }));
}
