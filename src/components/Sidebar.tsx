import { useEffect, useRef, useState } from 'react';
import { BookOpen, Copy, FilePlus2, FileUp, ImagePlus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useDoc } from '../lib/store';
import { renderComposite, viewSize } from '../lib/render';
import { IMAGE_ACCEPT, PDF_ACCEPT, pickFiles } from '../lib/util';
import type { Page } from '../lib/types';

const THUMB_W = 132;
const PAGE_MIME = 'application/x-pdfstudio-page';

function Thumbnail({ page }: { page: Page }) {
  const files = useDoc((s) => s.files);
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const { w, h } = viewSize(page);

  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const canvas = await renderComposite(page, files, (THUMB_W / w) * (window.devicePixelRatio || 1));
        const el = ref.current;
        if (cancelled || !el) return;
        el.width = canvas.width;
        el.height = canvas.height;
        el.getContext('2d')!.drawImage(canvas, 0, 0);
      } catch (err) {
        console.error(err);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [visible, page, files, w]);

  return <canvas ref={ref} className="thumb-canvas" style={{ width: THUMB_W, height: (THUMB_W * h) / w }} />;
}

export function Sidebar({ onCover }: { onCover: () => void }) {
  const pages = useDoc((s) => s.pages);
  const currentId = useDoc((s) => s.currentId);
  const st = useDoc.getState();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const insertFiles = async (accept: string) => {
    const files = await pickFiles(accept, true);
    if (files.length) await st.run('Adding pages…', () => st.openFiles(files, 'insert'));
  };

  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentId]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>Pages</span>
        <span className="count">{pages.length}</span>
      </div>
      <div className="thumbs">
        {pages.map((p, i) => (
          <div
            key={p.id}
            ref={p.id === currentId ? activeRef : undefined}
            className={`thumb${p.id === currentId ? ' active' : ''}${over === i && drag !== null && drag !== i ? ' drop' : ''}`}
            draggable
            onClick={() => st.setCurrent(p.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData(PAGE_MIME, String(i));
              e.dataTransfer.effectAllowed = 'move';
              setDrag(i);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(PAGE_MIME)) return;
              e.preventDefault();
              setOver(i);
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes(PAGE_MIME)) return;
              e.preventDefault();
              e.stopPropagation();
              const from = Number(e.dataTransfer.getData(PAGE_MIME));
              if (from !== i) st.movePage(from, i);
              setDrag(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
          >
            <Thumbnail page={p} />
            <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
              <button title="Rotate left" onClick={() => st.rotatePage(p.id, -90)}>
                <RotateCcw size={14} />
              </button>
              <button title="Rotate right" onClick={() => st.rotatePage(p.id, 90)}>
                <RotateCw size={14} />
              </button>
              <button title="Duplicate page" onClick={() => st.duplicatePage(p.id)}>
                <Copy size={14} />
              </button>
              <button
                title="Delete page"
                className="danger"
                onClick={() => {
                  if (pages.length === 1 || confirm(`Delete page ${i + 1}?`)) st.deletePage(p.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="thumb-num">{i + 1}</div>
          </div>
        ))}
      </div>
      <div className="sidebar-foot">
        <span className="foot-label">Add after current page</span>
        <div className="foot-grid">
          <button onClick={() => st.addBlankPage()}>
            <FilePlus2 size={16} /> Blank page
          </button>
          <button onClick={() => insertFiles(PDF_ACCEPT)}>
            <FileUp size={16} /> PDF pages
          </button>
          <button onClick={() => insertFiles(IMAGE_ACCEPT)}>
            <ImagePlus size={16} /> Image page
          </button>
          <button onClick={onCover}>
            <BookOpen size={16} /> Cover
          </button>
        </div>
      </div>
    </aside>
  );
}
