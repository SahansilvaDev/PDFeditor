import { pdfjsLib } from './pdfjs';
import type { Page, SourceFile } from './types';
import { totalRot } from './render';

export interface TextItem {
  str: string;
  /** Left edge and baseline in view coordinates (points, rotated view). */
  x: number;
  baseline: number;
  w: number;
  size: number;
  family: string;
  horizontal: boolean;
}

function mapFamily(fontFamily: string | undefined, fontName: string) {
  const f = `${fontFamily ?? ''} ${fontName}`.toLowerCase();
  if (f.includes('mono') || f.includes('courier')) return '"Courier New", Courier, monospace';
  if (f.includes('serif') && !f.includes('sans')) return '"Times New Roman", Times, serif';
  if (f.includes('times')) return '"Times New Roman", Times, serif';
  return 'Arial, Helvetica, sans-serif';
}

/** Extracts the text runs of a PDF page in editor (view) coordinates. */
export async function getTextItems(page: Page, files: Record<string, SourceFile>): Promise<TextItem[]> {
  if (page.source.kind !== 'pdf') return [];
  const pdfPage = await files[page.source.fileId].pdf.getPage(page.source.index + 1);
  const viewport = pdfPage.getViewport({ scale: 1, rotation: totalRot(page) });
  const content = await pdfPage.getTextContent();
  const out: TextItem[] = [];
  for (const item of content.items as any[]) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size < 0.5) continue;
    const angle = Math.atan2(tx[1], tx[0]);
    const style = (content.styles as any)[item.fontName];
    out.push({
      str: item.str,
      x: tx[4],
      baseline: tx[5],
      w: item.width,
      size,
      family: mapFamily(style?.fontFamily, item.fontName),
      horizontal: Math.abs(angle) < 0.05,
    });
  }
  return out;
}

export interface FontStyle {
  family: string;
  weight: 'normal' | 'bold' | number;
  italic: boolean;
}

export interface BlockLine {
  text: string;
  x: number;
  baseline: number;
  w: number;
}

/** A line or paragraph of existing PDF text that can be edited as one text box. */
export interface TextBlock extends FontStyle {
  /** Stable id (based on PDF content order) so an edited block is recognised after rotation. */
  key: string;
  lines: BlockLine[];
  size: number;
  lineGap: number;
  align: 'left' | 'center' | 'right';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const SERIF = /times|georgia|garamond|cambria|book|minion|palatino|serif(?!.*sans)/i;
const MONO = /courier|mono|consol/i;

/** Turns a PDF font name such as "ABCDEF+Calibri-BoldItalic" into a CSS font. */
export function cssFont(pdfName: string | undefined, generic: string | undefined, bold?: boolean, italic?: boolean): FontStyle {
  const raw = (pdfName ?? '').replace(/^[A-Z]{6}\+/, '');
  const [familyPart, stylePart = ''] = raw.split(/[-,]/);
  const all = raw.toLowerCase();
  const semibold = /semibold|demibold|demi\b|medium/.test(all);
  const isBold = bold || /bold|black|heavy/.test(all);
  const isItalic = italic || /italic|oblique/.test(stylePart.toLowerCase() + all);
  let family = familyPart
    .replace(/(PS|MT|PSMT|Std|Pro|LT)$/g, '')
    .replace(/(Bold|Italic|Regular|Semibold|Light|Medium|Black|Oblique)+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  if (/^helvetica|^arial/i.test(family)) family = 'Arial';
  if (/^times/i.test(family)) family = 'Times New Roman';
  if (/^courier/i.test(family)) family = 'Courier New';
  const gen = MONO.test(all) || generic === 'monospace' ? 'monospace' : SERIF.test(all) || generic === 'serif' ? 'serif' : 'sans-serif';
  const fallback = gen === 'serif' ? '"Times New Roman", serif' : gen === 'monospace' ? '"Courier New", monospace' : 'Arial, sans-serif';
  return {
    family: family ? `"${family}", ${fallback}` : fallback,
    weight: semibold ? 600 : isBold ? 'bold' : 'normal',
    italic: isItalic,
  };
}

interface RawItem extends BlockLine {
  idx: number;
  size: number;
  font: FontStyle;
}

const sameFont = (a: FontStyle, b: FontStyle) => a.family === b.family && a.weight === b.weight && a.italic === b.italic;

/** Groups the text of a PDF page into editable lines / paragraphs (view coordinates). */
export async function getTextBlocks(page: Page, files: Record<string, SourceFile>): Promise<TextBlock[]> {
  if (page.source.kind !== 'pdf') return [];
  const pdfPage = await files[page.source.fileId].pdf.getPage(page.source.index + 1);
  // Make sure the page's fonts are resolved so their real names can be read.
  await pdfPage.getOperatorList();
  const viewport = pdfPage.getViewport({ scale: 1, rotation: totalRot(page) });
  const content = await pdfPage.getTextContent();
  const fonts = new Map<string, FontStyle>();
  const fontOf = (name: string) => {
    let f = fonts.get(name);
    if (!f) {
      let info: any = null;
      try {
        if ((pdfPage.commonObjs as any).has(name)) info = pdfPage.commonObjs.get(name);
      } catch {
        info = null;
      }
      f = cssFont(info?.name, (content.styles as any)[name]?.fontFamily, info?.bold, info?.italic);
      fonts.set(name, f);
    }
    return f;
  };

  const items: RawItem[] = [];
  (content.items as any[]).forEach((it, idx) => {
    if (typeof it.str !== 'string' || !it.str.trim()) return;
    const tx = pdfjsLib.Util.transform(viewport.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size < 0.5 || Math.abs(Math.atan2(tx[1], tx[0])) > 0.05) return;
    items.push({ idx, text: it.str, x: tx[4], baseline: tx[5], w: it.width, size, font: fontOf(it.fontName) });
  });

  // 1. rows of items sharing a baseline, split into segments at big gaps (columns)
  items.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const rows: RawItem[][] = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.baseline - row[0].baseline) < Math.max(it.size, row[0].size) * 0.35) row.push(it);
    else rows.push([it]);
  }
  const segments: (RawItem & { idxs: number[] })[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let seg: (RawItem & { idxs: number[]; chars: Map<FontStyle, number> }) | null = null;
    for (const it of row) {
      const gap = seg ? it.x - (seg.x + seg.w) : Infinity;
      if (seg && gap < Math.max(seg.size, it.size) * 1.5 && Math.abs(seg.size - it.size) < seg.size * 0.35) {
        const space = gap > it.size * 0.12 && !seg.text.endsWith(' ') && !it.text.startsWith(' ');
        seg.text += (space ? ' ' : '') + it.text;
        seg.w = Math.max(seg.w, it.x + it.w - seg.x);
        seg.size = Math.max(seg.size, it.size);
        seg.idxs.push(it.idx);
        seg.chars.set(it.font, (seg.chars.get(it.font) ?? 0) + it.text.length);
      } else {
        if (seg) segments.push(seg);
        seg = { ...it, idxs: [it.idx], chars: new Map([[it.font, it.text.length]]) };
      }
    }
    if (seg) {
      segments.push(seg);
    }
  }
  // Majority font per segment.
  for (const s of segments as any[]) {
    if (s.chars) s.font = [...(s.chars as Map<FontStyle, number>).entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // 2. stack lines into paragraphs
  const blocks: TextBlock[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    const line: BlockLine = { text, x: s.x, baseline: s.baseline, w: s.w };
    const target = [...blocks].reverse().find((b) => {
      const last = b.lines[b.lines.length - 1];
      const delta = s.baseline - last.baseline;
      if (Math.abs(b.size - s.size) > 0.6 || !sameFont(b, s.font)) return false;
      if (delta < b.size * 0.9 || delta > b.size * 1.9) return false;
      if (b.lines.length > 1 && Math.abs(delta - b.lineGap) > b.size * 0.25) return false;
      const overlap = Math.min(b.x1, s.x + s.w) - Math.max(b.x0, s.x);
      return overlap > Math.min(b.x1 - b.x0, s.w) * 0.5;
    });
    if (target) {
      if (target.lines.length === 1) target.lineGap = s.baseline - target.lines[0].baseline;
      target.lines.push(line);
      target.x0 = Math.min(target.x0, s.x);
      target.x1 = Math.max(target.x1, s.x + s.w);
      target.y1 = s.baseline + s.size * 0.25;
    } else {
      blocks.push({
        key: `t${s.idxs[0]}`,
        lines: [line],
        size: s.size,
        lineGap: s.size * 1.2,
        align: 'left',
        ...s.font,
        x0: s.x,
        y0: s.baseline - s.size * 0.9,
        x1: s.x + s.w,
        y1: s.baseline + s.size * 0.25,
      });
    }
  }

  // 3. detect alignment of multi-line blocks
  for (const b of blocks) {
    if (b.lines.length < 2) continue;
    const tol = b.size * 0.4;
    const spread = (f: (l: BlockLine) => number) => {
      const v = b.lines.map(f);
      return Math.max(...v) - Math.min(...v);
    };
    if (spread((l) => l.x) < tol) b.align = 'left';
    else if (spread((l) => l.x + l.w / 2) < tol) b.align = 'center';
    else if (spread((l) => l.x + l.w) < tol) b.align = 'right';
  }
  return blocks;
}

/** Bounding box used for whiteout / hit testing of a text item. */
export const itemBox = (t: TextItem) => ({
  left: t.x,
  top: t.baseline - t.size * 0.9,
  width: t.w,
  height: t.size * 1.15,
});
