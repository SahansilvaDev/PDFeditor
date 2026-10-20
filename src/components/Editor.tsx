import { useEffect, useRef, useState } from 'react';
import { Canvas, Ellipse, FabricImage, Line, Path, PencilBrush, Point, Rect, Textbox, util, type FabricObject } from 'fabric';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { currentPage, useDoc } from '../lib/store';
import { renderPageBackground, viewSize } from '../lib/render';
import { getTextBlocks, type TextBlock } from '../lib/text';
import { arrowPath, PROPS } from '../lib/overlay';
import { editorBridge } from '../lib/bridge';
import { withAlpha } from '../lib/util';
import type { OverlayJSON, Style, Tool } from '../lib/types';

const SHAPE_TOOLS: Tool[] = ['rect', 'ellipse', 'line', 'arrow', 'highlight', 'whiteout'];

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Reads the background colour (edge pixels around the box) and the text colour
 * (pixels that differ most from the background) from the rendered page.
 */
function sampleColors(canvas: HTMLCanvasElement | null, viewW: number, b: TextBlock) {
  const fallback = { bg: '#ffffff', fg: '#000000' };
  if (!canvas || !canvas.width || !viewW) return fallback;
  const s = canvas.width / viewW;
  const x = Math.max(0, Math.floor((b.x0 - 3) * s));
  const y = Math.max(0, Math.floor((b.y0 - 3) * s));
  const w = Math.min(canvas.width - x, Math.ceil((b.x1 - b.x0 + 6) * s));
  const h = Math.min(canvas.height - y, Math.ceil((b.y1 - b.y0 + 6) * s));
  if (w < 3 || h < 3) return fallback;
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, w, h).data;
  const px = (i: number, j: number) => {
    const o = (j * w + i) * 4;
    return [data[o], data[o + 1], data[o + 2]];
  };
  const edge: number[][] = [];
  for (let i = 0; i < w; i++) edge.push(px(i, 0), px(i, h - 1));
  for (let j = 0; j < h; j++) edge.push(px(0, j), px(w - 1, j));
  const median = (k: number) => edge.map((p) => p[k]).sort((a, b) => a - b)[edge.length >> 1];
  const bg = [median(0), median(1), median(2)];
  const inner: { d: number; p: number[] }[] = [];
  for (let j = 1; j < h - 1; j++)
    for (let i = 1; i < w - 1; i++) {
      const p = px(i, j);
      inner.push({ d: Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]), p });
    }
  inner.sort((a, b) => b.d - a.d);
  const top = inner.slice(0, Math.max(1, Math.floor(inner.length * 0.03)));
  if (!top.length || top[0].d < 40) return { bg: hex(bg[0], bg[1], bg[2]), fg: '#000000' };
  const avg = (k: number) => Math.round(top.reduce((s2, t) => s2 + t.p[k], 0) / top.length);
  return { bg: hex(bg[0], bg[1], bg[2]), fg: hex(avg(0), avg(1), avg(2)) };
}

/** Hit test in scene coordinates that respects rotation/scale of the object. */
function hits(o: FabricObject, x: number, y: number) {
  const p = util.transformPoint(new Point(x, y), util.invertTransform(o.calcTransformMatrix()));
  return Math.abs(p.x) <= o.width / 2 + 2 && Math.abs(p.y) <= o.height / 2 + 2;
}

export function Editor() {
  const page = useDoc(currentPage);
  const pages = useDoc((s) => s.pages);
  const files = useDoc((s) => s.files);
  const zoom = useDoc((s) => s.zoom);
  const tool = useDoc((s) => s.tool);
  const style = useDoc((s) => s.style);
  const docVersion = useDoc((s) => s.docVersion);

  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const fcRef = useRef<Canvas | null>(null);

  const toolRef = useRef(tool);
  const styleRef = useRef(style);
  toolRef.current = tool;
  styleRef.current = style;

  /** Page whose objects are currently loaded in the fabric canvas. */
  const loadedIdRef = useRef<string | null>(null);
  const lastSavedRef = useRef<OverlayJSON | null>(null);
  const loadingRef = useRef(false);
  const quietRef = useRef(false);
  const internalRef = useRef<OverlayJSON | null | undefined>(undefined);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const histRef = useRef(new Map<string, { undo: (OverlayJSON | null)[]; redo: (OverlayJSON | null)[] }>());
  const blocksRef = useRef<TextBlock[]>([]);
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; obj: FabricObject; kind: Tool } | null>(null);

  const hist = (id: string) => {
    let h = histRef.current.get(id);
    if (!h) histRef.current.set(id, (h = { undo: [], redo: [] }));
    return h;
  };

  const save = () => {
    const c = fcRef.current;
    const id = loadedIdRef.current;
    if (!c || !id || loadingRef.current || quietRef.current) return;
    const json = c.toObject(PROPS as any) as OverlayJSON;
    const h = hist(id);
    h.undo.push(lastSavedRef.current);
    if (h.undo.length > 60) h.undo.shift();
    h.redo = [];
    lastSavedRef.current = json;
    internalRef.current = json;
    useDoc.getState().setOverlay(id, json);
  };

  const restore = (from: 'undo' | 'redo') => {
    const id = loadedIdRef.current;
    if (!id) return;
    const h = hist(id);
    const stack = from === 'undo' ? h.undo : h.redo;
    if (!stack.length) return;
    const json = stack.pop()!;
    (from === 'undo' ? h.redo : h.undo).push(lastSavedRef.current);
    internalRef.current = json;
    useDoc.getState().setOverlay(id, json);
  };

  const fitWidth = () => {
    const pg = currentPage(useDoc.getState());
    const el = scrollRef.current;
    if (!pg || !el) return;
    const { w, h } = viewSize(pg);
    const byWidth = (el.clientWidth - 64) / w;
    const byHeight = (el.clientHeight - 64) / h;
    useDoc.getState().setZoom(Math.min(byWidth, Math.max(byHeight, byWidth * 0.6), 2));
  };

  /* ---------- canvas creation & event wiring (once) ---------- */
  useEffect(() => {
    const el = document.createElement('canvas');
    hostRef.current!.appendChild(el);
    const c = new Canvas(el, { preserveObjectStacking: true, stopContextMenu: true });
    fcRef.current = c;

    c.on('object:added', () => {
      if (!c.isDrawingMode) save();
    });
    c.on('object:modified', save);
    c.on('object:removed', save);
    c.on('path:created', save);
    c.on('text:editing:exited', (e: any) => {
      const t = e.target as Textbox | undefined;
      if (t && !t.text.trim()) c.remove(t);
      else save();
    });

    const point = (e: any) => c.getScenePoint(e.e);

    c.on('mouse:down', (opt: any) => {
      const t = toolRef.current;
      const s = styleRef.current;
      const p = point(opt);

      if (t === 'eraser') {
        if (opt.target) {
          c.remove(opt.target);
          c.requestRenderAll();
        }
        return;
      }

      if (t === 'text') {
        const tb = new Textbox('', {
          left: p.x,
          top: p.y - s.fontSize * 0.6,
          width: Math.max(160, s.fontSize * 12),
          fontSize: s.fontSize,
          fontFamily: s.fontFamily,
          fill: s.color,
        });
        useDoc.getState().setTool('select');
        c.add(tb);
        c.setActiveObject(tb);
        tb.enterEditing();
        c.requestRenderAll();
        return;
      }

      if (t === 'editText') {
        const active = c.getActiveObject() as any;
        const startEditing = (tb: Textbox) => {
          if (active !== tb) {
            if (active?.isEditing) active.exitEditing();
            c.setActiveObject(tb);
          }
          if (!tb.isEditing) tb.enterEditing();
          const pos = tb.getSelectionStartFromPointer(opt.e);
          tb.selectionStart = tb.selectionEnd = pos;
          tb.initDelayedCursor?.(true);
          c.requestRenderAll();
        };

        // 1. A text box that is already editable (edited before, or added).
        const existing = (c.getObjects().filter((o) => o instanceof Textbox) as Textbox[])
          .reverse()
          .find((o) => hits(o, p.x, p.y));
        if (existing) return startEditing(existing);

        if (active?.isEditing) active.exitEditing();
        c.discardActiveObject();

        // 2. Original PDF text: turn the paragraph into an editable text box in place.
        const done = new Set(c.getObjects().map((o: any) => o.pdfeSource).filter(Boolean));
        const b = blocksRef.current.find(
          (bl) => !done.has(bl.key) && p.x >= bl.x0 - 2 && p.x <= bl.x1 + 2 && p.y >= bl.y0 - 1 && p.y <= bl.y1 + 1,
        );
        if (!b) {
          c.requestRenderAll();
          return;
        }
        const pg = currentPage(useDoc.getState());
        const colors = sampleColors(bgRef.current, pg ? viewSize(pg).w : 0, b);
        const cover = new Rect({
          left: b.x0 - 1.5,
          top: b.y0 - 1,
          width: b.x1 - b.x0 + 3,
          height: b.y1 - b.y0 + 2,
          fill: colors.bg,
          strokeWidth: 0,
        });
        (cover as any).pdfeRole = 'whiteout';
        // Paragraphs keep their width so they re-wrap like the original; single lines
        // may grow up to the page margin before wrapping.
        const pageW = pg ? viewSize(pg).w : b.x1 + 100;
        const margin = 18;
        let left = b.x0;
        let width = b.x1 - b.x0 + b.size * 1.5;
        if (b.lines.length === 1) {
          const cx = (b.x0 + b.x1) / 2;
          const half = Math.min(cx, pageW - cx) - margin;
          // Centred lines (e.g. titles) grow on both sides, other lines grow to the right.
          if (Math.abs(cx - pageW / 2) < b.size && half > (b.x1 - b.x0) / 2) {
            b.align = 'center';
            left = cx - half;
            width = half * 2;
          } else {
            width = Math.max(width, pageW - margin - b.x0);
          }
        } else if (b.align === 'center') {
          left = b.x0 - b.size * 0.75;
        } else if (b.align === 'right') {
          left = b.x0 - b.size * 1.5;
        }
        const tb = new Textbox(b.lines.map((l) => l.text).join('\n'), {
          left,
          top: b.lines[0].baseline - b.size * 0.879,
          width,
          fontSize: b.size,
          fontFamily: b.family,
          fontWeight: b.weight,
          fontStyle: b.italic ? 'italic' : 'normal',
          lineHeight: b.lines.length > 1 ? b.lineGap / (b.size * 1.13) : 1.16,
          textAlign: b.align,
          fill: colors.fg,
        });
        (tb as any).pdfeSource = b.key;
        quietRef.current = true;
        c.add(cover, tb);
        quietRef.current = false;
        save();
        hoverRef.current = null;
        setHoverKey(null);
        tb.setCoords();
        startEditing(tb);
        return;
      }

      if (SHAPE_TOOLS.includes(t)) {
        const stroke = { stroke: s.color, strokeWidth: s.strokeWidth, strokeUniform: true };
        const fill = s.fillEnabled ? s.fill : '';
        let obj: FabricObject;
        switch (t) {
          case 'rect':
            obj = new Rect({ left: p.x, top: p.y, width: 1, height: 1, fill, ...stroke });
            break;
          case 'ellipse':
            obj = new Ellipse({ left: p.x, top: p.y, rx: 0.5, ry: 0.5, fill, ...stroke });
            break;
          case 'highlight':
            obj = new Rect({ left: p.x, top: p.y, width: 1, height: 1, fill: withAlpha(s.highlightColor, 0.4), strokeWidth: 0 });
            (obj as any).pdfeRole = 'highlight';
            break;
          case 'whiteout':
            obj = new Rect({ left: p.x, top: p.y, width: 1, height: 1, fill: '#ffffff', strokeWidth: 0 });
            (obj as any).pdfeRole = 'whiteout';
            break;
          default:
            obj = new Line([p.x, p.y, p.x, p.y], { ...stroke, strokeLineCap: 'round' });
        }
        quietRef.current = true;
        dragRef.current = { x: p.x, y: p.y, obj, kind: t };
        c.add(obj);
      }
    });

    c.on('mouse:move', (opt: any) => {
      const d = dragRef.current;
      if (!d) {
        if (toolRef.current !== 'editText') return;
        const p = point(opt);
        const done = new Set(c.getObjects().map((o: any) => o.pdfeSource).filter(Boolean));
        const b = blocksRef.current.find(
          (bl) => !done.has(bl.key) && p.x >= bl.x0 - 2 && p.x <= bl.x1 + 2 && p.y >= bl.y0 - 1 && p.y <= bl.y1 + 1,
        );
        const key = b?.key ?? null;
        if (key !== hoverRef.current) {
          hoverRef.current = key;
          setHoverKey(key);
        }
        return;
      }
      const p = point(opt);
      const left = Math.min(d.x, p.x);
      const top = Math.min(d.y, p.y);
      const w = Math.abs(p.x - d.x);
      const h = Math.abs(p.y - d.y);
      if (d.obj instanceof Line) d.obj.set({ x2: p.x, y2: p.y });
      else if (d.obj instanceof Ellipse) d.obj.set({ left, top, rx: w / 2, ry: h / 2 });
      else d.obj.set({ left, top, width: w, height: h });
      d.obj.setCoords();
      c.requestRenderAll();
    });

    c.on('mouse:up', (opt: any) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      const p = point(opt);
      if (Math.hypot(p.x - d.x, p.y - d.y) < 3) {
        c.remove(d.obj);
        quietRef.current = false;
        return;
      }
      if (d.kind === 'arrow') {
        const s = styleRef.current;
        c.remove(d.obj);
        c.add(
          new Path(arrowPath(d.x, d.y, p.x, p.y, s.strokeWidth), {
            fill: '',
            stroke: s.color,
            strokeWidth: s.strokeWidth,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            strokeUniform: true,
          }),
        );
      }
      quietRef.current = false;
      save();
      c.requestRenderAll();
    });

    editorBridge.current = {
      undo: () => restore('undo'),
      redo: () => restore('redo'),
      deleteSelected() {
        const objs = c.getActiveObjects();
        if (!objs.length || (c.getActiveObject() as any)?.isEditing) return;
        c.discardActiveObject();
        quietRef.current = true;
        c.remove(...objs);
        quietRef.current = false;
        save();
        c.requestRenderAll();
      },
      applyStyle(patch: Partial<Style>) {
        const objs = c.getActiveObjects();
        if (!objs.length) return;
        for (const o of objs as any[]) {
          if (o instanceof Textbox) {
            if (patch.color) o.set('fill', patch.color);
            if (patch.fontSize) o.set('fontSize', patch.fontSize);
            if (patch.fontFamily) o.set('fontFamily', patch.fontFamily);
          } else if (o.pdfeRole === 'highlight') {
            if (patch.highlightColor) o.set('fill', withAlpha(patch.highlightColor, 0.4));
          } else if (o.pdfeRole !== 'whiteout' && !(o instanceof FabricImage)) {
            if (patch.color) o.set('stroke', patch.color);
            if (patch.strokeWidth) o.set('strokeWidth', patch.strokeWidth);
            if ((o instanceof Rect || o instanceof Ellipse) && ('fill' in patch || 'fillEnabled' in patch)) {
              const s = { ...styleRef.current, ...patch };
              o.set('fill', s.fillEnabled ? s.fill : '');
            }
          }
          o.setCoords();
        }
        c.requestRenderAll();
        save();
      },
      async addImage(url: string) {
        const pg = currentPage(useDoc.getState());
        if (!pg) return;
        const { w, h } = viewSize(pg);
        const img = await FabricImage.fromURL(url);
        const s = Math.min(1, (w * 0.6) / img.width, (h * 0.6) / img.height);
        img.set({ scaleX: s, scaleY: s, left: (w - img.width * s) / 2, top: (h - img.height * s) / 2 });
        useDoc.getState().setTool('select');
        c.add(img);
        c.setActiveObject(img);
        c.requestRenderAll();
      },
      fitWidth,
      commit() {
        const active = c.getActiveObject() as any;
        if (active?.isEditing) active.exitEditing();
        c.discardActiveObject();
        c.requestRenderAll();
      },
    };

    const onScroll = () => c.calcOffset();
    const scrollEl = scrollRef.current!;
    scrollEl.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onScroll);

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const st = useDoc.getState();
      st.setZoom(st.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    scrollEl.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      scrollEl.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onScroll);
      editorBridge.current = null;
      fcRef.current = null;
      Promise.resolve(c.dispose()).finally(() => el.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('.modal-backdrop')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        restore(e.shiftKey ? 'redo' : 'undo');
      } else if (mod && key === 'y') {
        e.preventDefault();
        restore('redo');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        editorBridge.current?.deleteSelected();
      } else if (e.key === 'Escape') {
        useDoc.getState().setTool('select');
        fcRef.current?.discardActiveObject();
        fcRef.current?.requestRenderAll();
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        const st = useDoc.getState();
        const i = st.pages.findIndex((p) => p.id === st.currentId);
        const next = st.pages[i + (e.key === 'PageDown' ? 1 : -1)];
        if (next) st.setCurrent(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- fit to width when a new document is opened ---------- */
  useEffect(() => {
    requestAnimationFrame(fitWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docVersion]);

  /* ---------- load page objects into fabric ---------- */
  useEffect(() => {
    const c = fcRef.current;
    if (!c || !page) return;
    const { w, h } = viewSize(page);
    c.setDimensions({ width: w * zoom, height: h * zoom });
    c.setZoom(zoom);

    const samePage = loadedIdRef.current === page.id;
    if (samePage && page.overlay === lastSavedRef.current) {
      c.requestRenderAll();
      return;
    }
    // Changed from outside (rotation etc.) → old undo steps no longer apply.
    if (samePage && page.overlay !== internalRef.current) histRef.current.delete(page.id);

    const active = c.getActiveObject() as any;
    if (active?.isEditing) active.exitEditing();
    c.discardActiveObject();

    const id = page.id;
    const json = page.overlay;
    queueRef.current = queueRef.current.then(async () => {
      loadingRef.current = true;
      try {
        if (json) await c.loadFromJSON(json);
        else c.clear();
      } finally {
        loadingRef.current = false;
      }
      loadedIdRef.current = id;
      lastSavedRef.current = json;
      c.setZoom(useDoc.getState().zoom);
      c.requestRenderAll();
    });
  }, [page?.id, page?.overlay, page?.rotation, zoom]);

  /* ---------- render the PDF page underneath ---------- */
  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    const dpr = window.devicePixelRatio || 1;
    renderPageBackground(page, files, zoom * dpr)
      .then((canvas) => {
        const bg = bgRef.current;
        if (cancelled || !bg) return;
        bg.width = canvas.width;
        bg.height = canvas.height;
        bg.getContext('2d')!.drawImage(canvas, 0, 0);
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, page?.rotation, page?.bgColor, zoom, files]);

  /* ---------- existing PDF text blocks for "Edit text" ---------- */
  useEffect(() => {
    blocksRef.current = [];
    setBlocks([]);
    if (!page) return;
    let cancelled = false;
    getTextBlocks(page, files)
      .then((list) => {
        if (cancelled) return;
        blocksRef.current = list;
        setBlocks(list);
      })
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, page?.rotation, files]);

  /* ---------- tool configuration ---------- */
  useEffect(() => {
    const c = fcRef.current;
    if (!c) return;
    const drawing = tool === 'pen' || tool === 'highlighter';
    c.isDrawingMode = drawing;
    if (drawing) {
      const brush = new PencilBrush(c);
      brush.color = tool === 'pen' ? style.color : withAlpha(style.highlightColor, 0.4);
      brush.width = tool === 'pen' ? style.strokeWidth : Math.max(12, style.strokeWidth * 4);
      brush.strokeLineCap = tool === 'pen' ? 'round' : 'square';
      c.freeDrawingBrush = brush;
    }
    const select = tool === 'select';
    c.selection = select;
    c.skipTargetFind = !(select || tool === 'eraser');
    c.defaultCursor = select ? 'default' : tool === 'text' || tool === 'editText' ? 'text' : 'crosshair';
    c.hoverCursor = tool === 'eraser' ? 'pointer' : 'move';
    if (!select) {
      c.discardActiveObject();
      c.requestRenderAll();
    }
  }, [tool, style.color, style.strokeWidth, style.highlightColor]);

  const { w, h } = page ? viewSize(page) : { w: 0, h: 0 };
  const index = page ? pages.findIndex((p) => p.id === page.id) : -1;
  const edited = new Set((page?.overlay?.objects ?? []).map((o: any) => o.pdfeSource).filter(Boolean));
  const outlines = tool === 'editText' ? blocks.filter((b) => !edited.has(b.key)) : [];
  const go = (d: number) => {
    const next = pages[index + d];
    if (next) useDoc.getState().setCurrent(next.id);
  };

  return (
    <div className="editor">
      <div className="editor-scroll" ref={scrollRef}>
        <div className="page-wrap" style={{ width: w * zoom, height: h * zoom }}>
          <canvas ref={bgRef} className="page-bg" />
          <div ref={hostRef} className="page-fabric" />
          {outlines.length > 0 && (
            <div className="text-outlines">
              {outlines.map((b) => (
                <div
                  key={b.key}
                  className={`text-outline${b.key === hoverKey ? ' hover' : ''}`}
                  style={{
                    left: (b.x0 - 2) * zoom,
                    top: (b.y0 - 1) * zoom,
                    width: (b.x1 - b.x0 + 4) * zoom,
                    height: (b.y1 - b.y0 + 2) * zoom,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="pager">
        <button className="icon-btn" disabled={index <= 0} onClick={() => go(-1)} title="Previous page (PgUp)">
          <ChevronLeft size={18} />
        </button>
        <span>
          Page {index + 1} of {pages.length}
        </span>
        <button className="icon-btn" disabled={index >= pages.length - 1} onClick={() => go(1)} title="Next page (PgDn)">
          <ChevronRight size={18} />
        </button>
        {tool === 'editText' && page?.source.kind === 'pdf' && (
          <span className="hint">
            {blocks.length
              ? 'Click any outlined text to edit it in place · Esc to finish'
              : 'No editable text found on this page (it may be a scanned image)'}
          </span>
        )}
      </div>
    </div>
  );
}
