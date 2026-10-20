import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Modal } from './Modal';
import { useDoc } from '../lib/store';
import { buildCover, COVER_TEMPLATES, type CoverOptions } from '../lib/cover';
import { overlayToCanvas } from '../lib/overlay';
import { viewSize } from '../lib/render';
import { IMAGE_ACCEPT, PAGE_SIZES, pickFiles, readAsDataURL, uid } from '../lib/util';

type SizeKey = 'match' | 'photo' | keyof typeof PAGE_SIZES;

const imageSize = (url: string) =>
  new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not read the image'));
    img.src = url;
  });

const COVER_FONTS = [
  { label: 'Georgia (serif)', value: 'Georgia, serif' },
  { label: 'Arial (sans)', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
];

export function CoverDialog({ onClose }: { onClose: () => void }) {
  const pages = useDoc((s) => s.pages);
  const docName = useDoc((s) => s.docName);
  const first = pages[0];
  const [size, setSize] = useState<SizeKey>(first ? 'match' : 'A4');
  const [placement, setPlacement] = useState<'first' | 'replace'>('first');
  const [opts, setOpts] = useState<Omit<CoverOptions, 'width' | 'height'>>({
    template: 'classic',
    title: docName && docName !== 'Untitled' ? docName : 'Document Title',
    subtitle: 'A short description or subtitle',
    author: 'Your Name',
    date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    font: 'Georgia, serif',
    bg: '#ffffff',
    accent: '#1e3a8a',
    textColor: '#111827',
    image: null,
    photoText: true,
  });
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const isPhoto = opts.template === 'photo';

  const dims = (() => {
    if (size === 'photo' && imgSize) {
      // Same shape as the photo, longest side = A4 height.
      const long = PAGE_SIZES.A4.height;
      return imgSize.h >= imgSize.w
        ? { width: (long * imgSize.w) / imgSize.h, height: long }
        : { width: long, height: (long * imgSize.h) / imgSize.w };
    }
    if (size === 'match' && first) {
      const { w, h } = viewSize(first);
      return { width: w, height: h };
    }
    return PAGE_SIZES[size === 'match' || size === 'photo' ? 'A4' : size];
  })();

  const set = <K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const chooseImage = async () => {
    const [f] = await pickFiles(IMAGE_ACCEPT, false);
    if (!f) return;
    const url = await readAsDataURL(f);
    setImgSize(await imageSize(url));
    set('image', url);
  };

  const removeImage = () => {
    set('image', null);
    setImgSize(null);
    if (size === 'photo') setSize(first ? 'match' : 'A4');
  };

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const { overlay, bgColor } = await buildCover({ ...opts, ...dims });
      const scale = 300 / dims.width;
      const ov = await overlayToCanvas(overlay, dims.width, dims.height, scale);
      const el = previewRef.current;
      if (cancelled || !el) return;
      el.width = ov.width;
      el.height = ov.height;
      const ctx = el.getContext('2d')!;
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, el.width, el.height);
      ctx.drawImage(ov, 0, 0);
      if (opts.template === 'photo' && !opts.image) {
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '600 15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Choose a photo to use', el.width / 2, el.height * 0.3);
        ctx.fillText('as the cover page', el.width / 2, el.height * 0.3 + 22);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [opts, dims.width, dims.height]);

  const insert = async () => {
    const { overlay, bgColor } = await buildCover({ ...opts, ...dims });
    const page = {
      id: uid(),
      source: { kind: 'blank' as const },
      width: dims.width,
      height: dims.height,
      baseRotation: 0,
      rotation: 0,
      overlay,
      bgColor,
    };
    const st = useDoc.getState();
    if (placement === 'replace' && first) st.deletePage(first.id);
    st.insertPagesAt([page], 0, true);
    if (!first) st.setDocName(opts.title || 'Untitled');
    onClose();
  };

  return (
    <Modal
      title="Add a cover page"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={isPhoto && !opts.image} onClick={insert}>
            Insert cover
          </button>
        </>
      }
    >
      <div className="cover-layout">
        <div className="cover-form">
          <div className="field">
            <label>Template</label>
            <div className="seg">
              {COVER_TEMPLATES.map((t) => (
                <button key={t.id} className={opts.template === t.id ? 'on' : ''} onClick={() => set('template', t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Title</label>
            <input value={opts.title} onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className="field">
            <label>Subtitle</label>
            <input value={opts.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
          </div>
          <div className="row2">
            <div className="field">
              <label>Author / company</label>
              <input value={opts.author} onChange={(e) => set('author', e.target.value)} />
            </div>
            <div className="field">
              <label>Date</label>
              <input value={opts.date} onChange={(e) => set('date', e.target.value)} />
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Font</label>
              <select value={opts.font} onChange={(e) => set('font', e.target.value)}>
                {COVER_FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Colours</label>
              <div className="colors">
                <label className="swatch" title="Background">
                  <input type="color" value={opts.bg} onChange={(e) => set('bg', e.target.value)} />
                </label>
                <label className="swatch" title="Accent">
                  <input type="color" value={opts.accent} onChange={(e) => set('accent', e.target.value)} />
                </label>
                <label className="swatch" title="Text">
                  <input type="color" value={opts.textColor} onChange={(e) => set('textColor', e.target.value)} />
                </label>
                <span className="muted small">bg · accent · text</span>
              </div>
            </div>
          </div>
          <div className="field">
            <label>{isPhoto ? 'Cover photo' : 'Photo or logo (optional)'}</label>
            <div className="colors">
              <button className={`btn${isPhoto && !opts.image ? ' primary' : ''}`} onClick={chooseImage}>
                <ImagePlus size={16} /> {opts.image ? 'Change photo' : 'Upload photo'}
              </button>
              {opts.image && (
                <button className="btn" onClick={removeImage}>
                  <X size={16} /> Remove
                </button>
              )}
            </div>
            {opts.image && (
              <div className="photo-use">
                <span className="muted small">Use photo as:</span>
                <div className="seg">
                  <button className={!isPhoto ? 'on' : ''} onClick={() => isPhoto && set('template', 'classic')}>
                    Small picture / logo
                  </button>
                  <button className={isPhoto ? 'on' : ''} onClick={() => set('template', 'photo')}>
                    Full-page cover
                  </button>
                </div>
              </div>
            )}
            {isPhoto && (
              <label className="check">
                <input type="checkbox" checked={opts.photoText} onChange={(e) => set('photoText', e.target.checked)} />
                Show title &amp; text on the photo (untick for photo only)
              </label>
            )}
          </div>
          <div className="row2">
            <div className="field">
              <label>Page size</label>
              <select value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>
                {first && <option value="match">Same as first page</option>}
                {imgSize && <option value="photo">Same shape as photo (no cropping)</option>}
                <option value="A4">A4</option>
                <option value="Letter">US Letter</option>
                <option value="A5">A5</option>
              </select>
            </div>
            {first && (
              <div className="field">
                <label>Placement</label>
                <select value={placement} onChange={(e) => setPlacement(e.target.value as 'first' | 'replace')}>
                  <option value="first">Insert before page 1</option>
                  <option value="replace">Replace page 1</option>
                </select>
              </div>
            )}
          </div>
          <p className="muted small">
            {isPhoto && size !== 'photo' && imgSize
              ? 'The photo fills the page and is centre-cropped to fit. '
              : ''}
            Everything on the cover stays editable after inserting it.
          </p>
        </div>
        <div className="cover-preview">
          <canvas ref={previewRef} />
        </div>
      </div>
    </Modal>
  );
}
