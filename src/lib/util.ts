export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const PDF_ACCEPT = '.pdf,application/pdf';
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
  A5: { width: 419.53, height: 595.28 },
} as const;

export const FONTS: { label: string; value: string }[] = [
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
];

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb01(hex).map((v) => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'document';

/** Parses "1-3, 5, 8-" into zero-based page indices. Empty string = all pages. */
export function parseRange(input: string, count: number): number[] {
  const text = input.trim();
  if (!text) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(\d*)\s*(-\s*(\d*))?$/);
    if (!m || (!m[1] && !m[3])) throw new Error(`Invalid page range: "${part.trim()}"`);
    const start = m[1] ? parseInt(m[1], 10) : 1;
    const end = m[2] ? (m[3] ? parseInt(m[3], 10) : count) : start;
    for (let p = Math.max(1, start); p <= Math.min(count, end); p++) out.push(p - 1);
  }
  if (!out.length) throw new Error('The page range does not match any pages');
  return out;
}
