import { Circle, FabricImage, Gradient, Rect, Textbox, type StaticCanvas } from 'fabric';
import type { OverlayJSON } from './types';
import { makeStatic, PROPS } from './overlay';

export type CoverTemplate = 'classic' | 'band' | 'minimal' | 'bold' | 'photo';

export const COVER_TEMPLATES: { id: CoverTemplate; name: string }[] = [
  { id: 'photo', name: 'Full photo' },
  { id: 'classic', name: 'Classic' },
  { id: 'band', name: 'Modern band' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'bold', name: 'Bold colour' },
];

export interface CoverOptions {
  template: CoverTemplate;
  title: string;
  subtitle: string;
  author: string;
  date: string;
  font: string;
  bg: string;
  accent: string;
  textColor: string;
  image: string | null;
  /** Full photo template: draw title/subtitle/author/date over the photo. */
  photoText: boolean;
  width: number;
  height: number;
}

/** Fills the whole page with the photo (centre-cropped if the aspect ratio differs). */
async function fillWithImage(sc: StaticCanvas, url: string, W: number, H: number) {
  const img = await FabricImage.fromURL(url);
  const iw = img.width;
  const ih = img.height;
  const s = Math.max(W / iw, H / ih);
  const cw = W / s;
  const ch = H / s;
  img.set({
    cropX: (iw - cw) / 2,
    cropY: (ih - ch) / 2,
    width: cw,
    height: ch,
    scaleX: s,
    scaleY: s,
    left: 0,
    top: 0,
  });
  sc.add(img);
}

async function placeImage(
  sc: StaticCanvas,
  url: string,
  box: { x: number; y: number; w: number; h: number },
  align: 'center' | 'left' = 'center',
) {
  const img = await FabricImage.fromURL(url);
  const s = Math.min(box.w / img.width, box.h / img.height);
  img.set({
    scaleX: s,
    scaleY: s,
    left: align === 'center' ? box.x + (box.w - img.width * s) / 2 : box.x,
    top: box.y + (box.h - img.height * s) / 2,
  });
  sc.add(img);
}

/** Builds an editable cover page: returns overlay objects plus the page background colour. */
export async function buildCover(o: CoverOptions): Promise<{ overlay: OverlayJSON; bgColor: string }> {
  const W = o.width;
  const H = o.height;
  const u = Math.min(W, H) / 100;
  const sc = makeStatic(W, H);
  const text = (value: string, opts: Record<string, any>) => {
    if (!value.trim()) return null;
    const t = new Textbox(value, { fontFamily: o.font, fill: o.textColor, textAlign: 'center', ...opts });
    sc.add(t);
    return t;
  };
  const bottomOf = (t: Textbox | null, fallback: number) => (t ? t.top + t.height : fallback);
  let bgColor = o.bg;

  switch (o.template) {
    case 'photo': {
      bgColor = '#1f2937';
      if (o.image) await fillWithImage(sc, o.image, W, H);
      const hasText = o.photoText && [o.title, o.subtitle, o.author, o.date].some((t) => t.trim());
      if (!hasText) break;
      // Dark fade at the bottom keeps white text readable on any photo.
      sc.add(
        new Rect({
          left: 0,
          top: H * 0.45,
          width: W,
          height: H * 0.55,
          strokeWidth: 0,
          fill: new Gradient({
            type: 'linear',
            coords: { x1: 0, y1: 0, x2: 0, y2: H * 0.55 },
            colorStops: [
              { offset: 0, color: 'rgba(0,0,0,0)' },
              { offset: 0.55, color: 'rgba(0,0,0,0.55)' },
              { offset: 1, color: 'rgba(0,0,0,0.8)' },
            ],
          }),
        }),
      );
      const author = o.author.trim() || o.date.trim();
      const metaTop = H - u * 14;
      const sub = new Textbox(o.subtitle || ' ', { width: W - u * 16, fontSize: u * 4.2, fontFamily: o.font });
      const subTop = (author ? metaTop - u * 5 : H - u * 8) - (o.subtitle.trim() ? sub.height : 0);
      const probe = new Textbox(o.title || ' ', { width: W - u * 16, fontSize: u * 9, fontFamily: o.font, fontWeight: 'bold' });
      text(o.title, {
        left: u * 8, top: subTop - u * 3 - probe.height, width: W - u * 16, fontSize: u * 9,
        fontWeight: 'bold', textAlign: 'left', fill: '#ffffff',
      });
      sc.add(new Rect({ left: u * 8, top: subTop - u * 1.6, width: u * 14, height: u * 0.8, fill: o.accent, strokeWidth: 0 }));
      text(o.subtitle, { left: u * 8, top: subTop, width: W - u * 16, fontSize: u * 4.2, textAlign: 'left', fill: '#ffffff', opacity: 0.92 });
      text([o.author.trim(), o.date.trim()].filter(Boolean).join('  ·  '), {
        left: u * 8, top: metaTop, width: W - u * 16, fontSize: u * 3.2, textAlign: 'left', fill: '#ffffff', opacity: 0.85,
      });
      break;
    }
    case 'classic': {
      sc.add(new Rect({ left: u * 4, top: u * 4, width: W - u * 8, height: H - u * 8, fill: '', stroke: o.accent, strokeWidth: u * 0.6 }));
      sc.add(new Rect({ left: u * 6, top: u * 6, width: W - u * 12, height: H - u * 12, fill: '', stroke: o.accent, strokeWidth: u * 0.2 }));
      if (o.image) await placeImage(sc, o.image, { x: W * 0.3, y: H * 0.1, w: W * 0.4, h: H * 0.18 });
      const title = text(o.title, { left: u * 12, top: H * 0.34, width: W - u * 24, fontSize: u * 8, fontWeight: 'bold' });
      const lineY = bottomOf(title, H * 0.42) + u * 4;
      sc.add(new Rect({ left: W / 2 - u * 10, top: lineY, width: u * 20, height: u * 0.7, fill: o.accent }));
      text(o.subtitle, { left: u * 14, top: lineY + u * 5, width: W - u * 28, fontSize: u * 4, fontStyle: 'italic' });
      const author = text(o.author, { left: u * 12, top: H * 0.78, width: W - u * 24, fontSize: u * 3.6, fontWeight: 'bold' });
      text(o.date, { left: u * 12, top: bottomOf(author, H * 0.78) + u * 1.5, width: W - u * 24, fontSize: u * 3 });
      break;
    }
    case 'band': {
      const bandH = H * 0.48;
      sc.add(new Rect({ left: 0, top: 0, width: W, height: bandH, fill: o.accent, strokeWidth: 0 }));
      sc.add(new Rect({ left: u * 8, top: bandH - u * 1, width: u * 18, height: u * 2, fill: o.textColor, strokeWidth: 0 }));
      const probe = new Textbox(o.title || ' ', { width: W - u * 16, fontSize: u * 8.5, fontFamily: o.font, fontWeight: 'bold' });
      text(o.title, {
        left: u * 8, top: bandH - u * 6 - probe.height, width: W - u * 16, fontSize: u * 8.5,
        fontWeight: 'bold', textAlign: 'left', fill: '#ffffff',
      });
      const sub = text(o.subtitle, { left: u * 8, top: bandH + u * 6, width: W - u * 16, fontSize: u * 4.2, textAlign: 'left' });
      if (o.image) await placeImage(sc, o.image, { x: u * 8, y: bottomOf(sub, bandH + u * 6) + u * 6, w: W - u * 16, h: H * 0.22 });
      const author = text(o.author, { left: u * 8, top: H - u * 20, width: W - u * 16, fontSize: u * 3.6, fontWeight: 'bold', textAlign: 'left' });
      text(o.date, { left: u * 8, top: bottomOf(author, H - u * 20) + u * 1.5, width: W - u * 16, fontSize: u * 3, textAlign: 'left' });
      break;
    }
    case 'minimal': {
      if (o.image) await placeImage(sc, o.image, { x: u * 10, y: u * 10, w: W * 0.3, h: H * 0.1 }, 'left');
      const top = H * 0.5;
      const title = text(o.title, { left: u * 14, top, width: W - u * 24, fontSize: u * 9, fontWeight: 'bold', textAlign: 'left' });
      const sub = text(o.subtitle, { left: u * 14, top: bottomOf(title, top) + u * 3, width: W - u * 24, fontSize: u * 4, textAlign: 'left', fill: o.accent });
      sc.add(new Rect({ left: u * 10, top, width: u * 1.2, height: Math.max(u * 10, bottomOf(sub, bottomOf(title, top + u * 10)) - top), fill: o.accent, strokeWidth: 0 }));
      sc.add(new Rect({ left: u * 10, top: H - u * 18, width: W - u * 20, height: u * 0.25, fill: o.textColor, strokeWidth: 0, opacity: 0.4 }));
      text(o.author, { left: u * 10, top: H - u * 15, width: (W - u * 20) / 2, fontSize: u * 3.4, textAlign: 'left' });
      text(o.date, { left: W / 2, top: H - u * 15, width: (W - u * 20) / 2, fontSize: u * 3.4, textAlign: 'right' });
      break;
    }
    case 'bold': {
      bgColor = o.accent;
      sc.add(new Circle({ left: W - u * 45, top: -u * 25, radius: u * 50, fill: '#ffffff', opacity: 0.1, strokeWidth: 0 }));
      sc.add(new Circle({ left: -u * 30, top: H - u * 45, radius: u * 40, fill: '#000000', opacity: 0.1, strokeWidth: 0 }));
      if (o.image) await placeImage(sc, o.image, { x: W * 0.3, y: H * 0.14, w: W * 0.4, h: H * 0.18 });
      const title = text(o.title, { left: u * 10, top: H * 0.38, width: W - u * 20, fontSize: u * 10, fontWeight: 'bold', fill: '#ffffff' });
      text(o.subtitle, { left: u * 12, top: bottomOf(title, H * 0.45) + u * 4, width: W - u * 24, fontSize: u * 4.4, fill: '#ffffff', opacity: 0.9 });
      const author = text(o.author, { left: u * 10, top: H * 0.82, width: W - u * 20, fontSize: u * 3.6, fontWeight: 'bold', fill: '#ffffff' });
      text(o.date, { left: u * 10, top: bottomOf(author, H * 0.82) + u * 1.5, width: W - u * 20, fontSize: u * 3, fill: '#ffffff', opacity: 0.85 });
      break;
    }
  }

  const overlay = sc.toObject(PROPS as any) as OverlayJSON;
  sc.dispose();
  return { overlay, bgColor };
}
