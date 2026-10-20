import type { Page, SourceFile } from './types';
import { hasObjects, overlayToCanvas } from './overlay';

export const totalRot = (p: Page) => ((((p.baseRotation + p.rotation) % 360) + 360) % 360) as 0 | 90 | 180 | 270;

/** Size of the page as displayed (after rotation), in points. */
export function viewSize(p: Page) {
  return totalRot(p) % 180 === 0 ? { w: p.width, h: p.height } : { w: p.height, h: p.width };
}

/** Renders the page content (PDF page or blank/coloured page) into a new canvas. */
export async function renderPageBackground(
  page: Page,
  files: Record<string, SourceFile>,
  scale: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  if (page.source.kind === 'pdf') {
    const file = files[page.source.fileId];
    const pdfPage = await file.pdf.getPage(page.source.index + 1);
    const viewport = pdfPage.getViewport({ scale, rotation: totalRot(page) });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  } else {
    const { w, h } = viewSize(page);
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    ctx.fillStyle = page.bgColor || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

/** Page content with all edits / drawings flattened on top. */
export async function renderComposite(page: Page, files: Record<string, SourceFile>, scale: number) {
  const canvas = await renderPageBackground(page, files, scale);
  if (hasObjects(page.overlay)) {
    const { w, h } = viewSize(page);
    const ov = await overlayToCanvas(page.overlay, w, h, scale);
    canvas.getContext('2d')!.drawImage(ov, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}
