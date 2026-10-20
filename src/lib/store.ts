import { create } from 'zustand';
import { FabricImage } from 'fabric';
import { pdfjsLib } from './pdfjs';
import type { OverlayJSON, Page, SourceFile, Style, Tool } from './types';
import { PAGE_SIZES, baseName, readAsDataURL, uid } from './util';
import { makeStatic, PROPS, rotateOverlay } from './overlay';
import { viewSize } from './render';

export type OpenMode = 'replace' | 'append' | 'insert';

interface DocState {
  files: Record<string, SourceFile>;
  pages: Page[];
  currentId: string | null;
  docName: string;
  /** Bumped whenever a new document replaces the old one. */
  docVersion: number;
  tool: Tool;
  style: Style;
  zoom: number;
  busy: string | null;

  setTool(tool: Tool): void;
  setStyle(patch: Partial<Style>): void;
  setZoom(zoom: number): void;
  setCurrent(id: string): void;
  setDocName(name: string): void;
  setOverlay(id: string, overlay: OverlayJSON | null): void;

  run<T>(label: string, task: () => Promise<T>): Promise<T | undefined>;
  openFiles(files: File[], mode: OpenMode): Promise<void>;
  newBlankDocument(): void;
  /** Discards the open document and returns to the home screen. */
  closeDocument(): void;
  addBlankPage(): void;
  insertPagesAt(pages: Page[], index: number, select?: boolean): void;
  deletePage(id: string): void;
  duplicatePage(id: string): void;
  movePage(from: number, to: number): void;
  rotatePage(id: string, delta: 90 | -90): Promise<void>;
}

const defaultStyle: Style = {
  color: '#111827',
  fill: '#3b82f6',
  fillEnabled: false,
  strokeWidth: 3,
  fontSize: 16,
  fontFamily: 'Arial, Helvetica, sans-serif',
  highlightColor: '#facc15',
};

const blankPage = (width: number, height: number, bgColor: string | null = null): Page => ({
  id: uid(),
  source: { kind: 'blank' },
  width,
  height,
  baseRotation: 0,
  rotation: 0,
  overlay: null,
  bgColor,
});

async function loadPdf(file: File): Promise<{ src: SourceFile; pages: Page[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let pdf;
  try {
    // pdf.js transfers the buffer to its worker, so give it a copy.
    pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  } catch (err: any) {
    if (err?.name === 'PasswordException') throw new Error(`"${file.name}" is password protected.`);
    throw new Error(`"${file.name}" could not be opened as a PDF.`);
  }
  const src: SourceFile = { id: uid(), name: file.name, bytes, pdf };
  const pages: Page[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const [x0, y0, x1, y1] = p.view;
    pages.push({
      id: uid(),
      source: { kind: 'pdf', fileId: src.id, index: i - 1 },
      width: x1 - x0,
      height: y1 - y0,
      baseRotation: p.rotate || 0,
      rotation: 0,
      overlay: null,
      bgColor: null,
    });
  }
  return { src, pages };
}

/** Turns an image file into a page that shows the image fitted with a small margin. */
async function imageToPage(file: File): Promise<Page> {
  const url = await readAsDataURL(file);
  const img = await FabricImage.fromURL(url);
  const landscape = img.width > img.height;
  const { width, height } = landscape
    ? { width: PAGE_SIZES.A4.height, height: PAGE_SIZES.A4.width }
    : PAGE_SIZES.A4;
  const margin = 24;
  const s = Math.min((width - margin * 2) / img.width, (height - margin * 2) / img.height);
  img.set({
    scaleX: s,
    scaleY: s,
    left: (width - img.width * s) / 2,
    top: (height - img.height * s) / 2,
  });
  const sc = makeStatic(width, height);
  sc.add(img);
  const overlay = sc.toObject(PROPS as any) as OverlayJSON;
  sc.dispose();
  return { ...blankPage(width, height), overlay };
}

export const useDoc = create<DocState>((set, get) => ({
  files: {},
  pages: [],
  currentId: null,
  docName: 'document',
  docVersion: 0,
  tool: 'select',
  style: defaultStyle,
  zoom: 1,
  busy: null,

  setTool: (tool) => set({ tool }),
  setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.2, zoom)) }),
  setCurrent: (currentId) => set({ currentId }),
  setDocName: (docName) => set({ docName }),
  setOverlay: (id, overlay) =>
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, overlay } : p)) })),

  async run(label, task) {
    set({ busy: label });
    try {
      return await task();
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? String(err));
      return undefined;
    } finally {
      set({ busy: null });
    }
  },

  async openFiles(fileList, mode) {
    const newFiles: SourceFile[] = [];
    const newPages: Page[] = [];
    for (const f of fileList) {
      if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
        const { src, pages } = await loadPdf(f);
        newFiles.push(src);
        newPages.push(...pages);
      } else if (f.type.startsWith('image/')) {
        newPages.push(await imageToPage(f));
      }
    }
    if (!newPages.length) throw new Error('No PDF or image files were selected.');

    const state = get();
    if (mode === 'replace') {
      Object.values(state.files).forEach((f) => f.pdf.destroy());
      set((s) => ({
        files: Object.fromEntries(newFiles.map((f) => [f.id, f])),
        pages: newPages,
        currentId: newPages[0].id,
        docName: baseName(fileList[0].name),
        docVersion: s.docVersion + 1,
        tool: 'select',
      }));
      return;
    }
    set((s) => ({ files: { ...s.files, ...Object.fromEntries(newFiles.map((f) => [f.id, f])) } }));
    const cur = state.pages.findIndex((p) => p.id === state.currentId);
    const index = mode === 'insert' && cur >= 0 ? cur + 1 : state.pages.length;
    get().insertPagesAt(newPages, index, true);
  },

  newBlankDocument() {
    Object.values(get().files).forEach((f) => f.pdf.destroy());
    const p = blankPage(PAGE_SIZES.A4.width, PAGE_SIZES.A4.height);
    set((s) => ({
      files: {},
      pages: [p],
      currentId: p.id,
      docName: 'Untitled',
      docVersion: s.docVersion + 1,
      tool: 'select',
    }));
  },

  closeDocument() {
    Object.values(get().files).forEach((f) => f.pdf.destroy());
    set((s) => ({
      files: {},
      pages: [],
      currentId: null,
      docName: 'document',
      docVersion: s.docVersion + 1,
      tool: 'select',
    }));
  },

  addBlankPage() {
    const { pages, currentId } = get();
    const cur = pages.find((p) => p.id === currentId);
    const size = cur ? viewSize(cur) : { w: PAGE_SIZES.A4.width, h: PAGE_SIZES.A4.height };
    const idx = cur ? pages.indexOf(cur) + 1 : pages.length;
    get().insertPagesAt([blankPage(size.w, size.h)], idx, true);
  },

  insertPagesAt(newPages, index, select = true) {
    set((s) => {
      const pages = [...s.pages];
      pages.splice(index, 0, ...newPages);
      return {
        pages,
        currentId: select || !s.currentId ? newPages[0].id : s.currentId,
        docVersion: s.pages.length ? s.docVersion : s.docVersion + 1,
      };
    });
  },

  deletePage(id) {
    set((s) => {
      const idx = s.pages.findIndex((p) => p.id === id);
      const pages = s.pages.filter((p) => p.id !== id);
      const currentId =
        s.currentId === id ? (pages[Math.min(idx, pages.length - 1)]?.id ?? null) : s.currentId;
      return { pages, currentId };
    });
  },

  duplicatePage(id) {
    const { pages } = get();
    const idx = pages.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const src = pages[idx];
    const copy: Page = { ...src, id: uid(), overlay: src.overlay ? structuredClone(src.overlay) : null };
    get().insertPagesAt([copy], idx + 1, true);
  },

  movePage(from, to) {
    set((s) => {
      const pages = [...s.pages];
      const [p] = pages.splice(from, 1);
      pages.splice(to, 0, p);
      return { pages };
    });
  },

  async rotatePage(id, delta) {
    const page = get().pages.find((p) => p.id === id);
    if (!page) return;
    const { w, h } = viewSize(page);
    const overlay = await rotateOverlay(page.overlay, w, h, delta);
    set((s) => ({
      pages: s.pages.map((p) =>
        p.id === id ? { ...p, overlay, rotation: (((p.rotation + delta) % 360) + 360) % 360 } : p,
      ),
    }));
  },
}));

export const currentPage = (s: DocState) => s.pages.find((p) => p.id === s.currentId) ?? null;
