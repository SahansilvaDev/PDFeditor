import {
  BookOpen,
  FilePlus2,
  FileType2,
  FileUp,
  Layers,
  Merge,
  PenTool,
  ShieldCheck,
  TextCursorInput,
  UploadCloud,
} from 'lucide-react';
import iconUrl from '../assets/icon.png';
import logoUrl from '../assets/sahansilva-logo.png';

const FEATURES = [
  { icon: TextCursorInput, label: 'Edit text in place' },
  { icon: PenTool, label: 'Draw & annotate' },
  { icon: Layers, label: 'Add & reorder pages' },
  { icon: BookOpen, label: 'Cover pages' },
  { icon: Merge, label: 'Merge PDFs' },
  { icon: FileType2, label: 'Export PDF or Word' },
];

export function Home(props: { onOpen: () => void; onMerge: () => void; onCover: () => void; onBlank: () => void }) {
  const actions = [
    { icon: FileUp, title: 'Open PDF', text: 'Edit text, draw, add or remove pages', onClick: props.onOpen, accent: true },
    { icon: Merge, title: 'Merge PDFs', text: 'Combine several PDFs into one', onClick: props.onMerge },
    { icon: BookOpen, title: 'Create a cover', text: 'Templates or your own photo', onClick: props.onCover },
    { icon: FilePlus2, title: 'Blank document', text: 'Start from an empty A4 page', onClick: props.onBlank },
  ];

  return (
    <div className="home">
      <div className="home-glow g1" />
      <div className="home-glow g2" />
      <div className="home-grid" />

      <header className="home-head">
        <div className="home-brand">
          <img src={iconUrl} alt="PDF Studio" />
          <span>PDF Studio</span>
        </div>
        <span className="home-pill">
          <ShieldCheck size={14} /> 100% private · runs in your browser
        </span>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1>
            Edit, draw, combine
            <br />
            <span>&amp; convert PDFs</span>
          </h1>
          <p>
            A fast, free PDF editor. Change existing text, sign and draw, add pages and covers, merge files and export
            to PDF or Word. Your files never leave your device.
          </p>
          <div className="home-cta">
            <button className="cta primary" onClick={props.onOpen}>
              <FileUp size={18} /> Open a PDF
            </button>
            <button className="cta" onClick={props.onMerge}>
              <Merge size={18} /> Merge PDFs
            </button>
          </div>
          <div className="home-drop">
            <UploadCloud size={16} /> or drag &amp; drop PDF / image files anywhere
          </div>
        </section>

        <section className="home-actions">
          {actions.map(({ icon: Icon, title, text, onClick, accent }) => (
            <button key={title} className={`home-card${accent ? ' accent' : ''}`} onClick={onClick}>
              <span className="home-card-icon">
                <Icon size={22} />
              </span>
              <strong>{title}</strong>
              <span>{text}</span>
            </button>
          ))}
        </section>
      </main>

      <div className="home-features">
        {FEATURES.map(({ icon: Icon, label }) => (
          <span key={label}>
            <Icon size={15} /> {label}
          </span>
        ))}
      </div>

      <footer className="home-foot">
        <span>© {new Date().getFullYear()} PDF Studio</span>
        <a className="dev-by" href="https://github.com/SahansilvaDev" target="_blank" rel="noreferrer">
          <span>Developed by</span>
          <img src={logoUrl} alt="Sahan Silva" />
        </a>
      </footer>
    </div>
  );
}
