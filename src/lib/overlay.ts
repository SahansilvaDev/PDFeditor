import { StaticCanvas, Point, util } from 'fabric';
import type { OverlayJSON } from './types';

/**
 * Custom object properties that must survive serialisation.
 * pdfeRole: 'whiteout' | 'highlight'; pdfeSource: key of the PDF text block a text box replaces.
 */
export const PROPS = ['pdfeRole', 'pdfeSource'];

/** One visual line of a text box, in view coordinates (baseline start point). */
export interface TextRun {
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
  /** Clockwise rotation in degrees (fabric angle). */
  angle: number;
}

/** Extracts the wrapped lines of every text box so they can be written as real PDF text. */
export async function overlayTextRuns(json: OverlayJSON | null, viewW: number, viewH: number): Promise<TextRun[]> {
  if (!hasObjects(json) || !json.objects!.some((o) => String(o.type).toLowerCase().includes('text'))) return [];
  const sc = makeStatic(viewW, viewH);
  const runs: TextRun[] = [];
  try {
    await sc.loadFromJSON(json);
    for (const o of sc.getObjects() as any[]) {
      if (!Array.isArray(o.textLines) || typeof o.getHeightOfLine !== 'function') continue;
      const m = o.calcTransformMatrix();
      let top = -o.height / 2;
      o.textLines.forEach((line: string, i: number) => {
        const h = o.getHeightOfLine(i);
        if (line.trim()) {
          const baseline = top + (h / o.lineHeight) * (1 - o._fontSizeFraction);
          const left = -o.width / 2 + o._getLineLeftOffset(i);
          const p = util.transformPoint(new Point(left, baseline), m);
          runs.push({
            text: line,
            x: p.x,
            y: p.y,
            size: o.fontSize * (o.scaleY ?? 1),
            width: o.getLineWidth(i) * (o.scaleX ?? 1),
            angle: o.angle ?? 0,
          });
        }
        top += h;
      });
    }
  } finally {
    sc.dispose();
  }
  return runs;
}

export const hasObjects = (json: OverlayJSON | null | undefined): json is OverlayJSON =>
  !!json && Array.isArray(json.objects) && json.objects.length > 0;

export function makeStatic(width: number, height: number) {
  const el = document.createElement('canvas');
  return new StaticCanvas(el, {
    width,
    height,
    enableRetinaScaling: false,
    renderOnAddRemove: false,
  });
}

/** Renders overlay objects onto a transparent canvas at `scale` pixels per point. */
export async function overlayToCanvas(
  json: OverlayJSON,
  viewW: number,
  viewH: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const sc = makeStatic(viewW, viewH);
  try {
    await sc.loadFromJSON(json);
    sc.renderAll();
    return sc.toCanvasElement(scale);
  } finally {
    sc.dispose();
  }
}

/**
 * Moves every object so it stays on the same spot of the page content after the
 * page is rotated by `delta` degrees clockwise.
 */
export async function rotateOverlay(
  json: OverlayJSON | null,
  viewW: number,
  viewH: number,
  delta: 90 | -90 | 180,
): Promise<OverlayJSON | null> {
  if (!hasObjects(json)) return json;
  const sc = makeStatic(viewW, viewH);
  try {
    await sc.loadFromJSON(json);
    for (const o of sc.getObjects()) {
      const c = o.getCenterPoint();
      const next =
        delta === 90
          ? new Point(viewH - c.y, c.x)
          : delta === -90
            ? new Point(c.y, viewW - c.x)
            : new Point(viewW - c.x, viewH - c.y);
      o.set('angle', (((o.angle ?? 0) + delta) % 360 + 360) % 360);
      o.setPositionByOrigin(next, 'center', 'center');
      o.setCoords();
    }
    return sc.toObject(PROPS as any) as OverlayJSON;
  } finally {
    sc.dispose();
  }
}

export function arrowPath(x1: number, y1: number, x2: number, y2: number, strokeWidth: number) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(10, strokeWidth * 4);
  const spread = Math.PI / 7;
  const hx1 = x2 - head * Math.cos(ang - spread);
  const hy1 = y2 - head * Math.sin(ang - spread);
  const hx2 = x2 - head * Math.cos(ang + spread);
  const hy2 = y2 - head * Math.sin(ang + spread);
  return `M ${x1} ${y1} L ${x2} ${y2} M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`;
}
