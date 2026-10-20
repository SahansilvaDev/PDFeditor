import { useState } from 'react';
import { FileText, FileType2 } from 'lucide-react';
import { Modal } from './Modal';
import { useDoc } from '../lib/store';
import { exportPdf } from '../lib/exportPdf';
import { exportDocx, type DocxMode } from '../lib/exportDocx';
import { downloadBlob, parseRange } from '../lib/util';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const docName = useDoc((s) => s.docName);
  const pageCount = useDoc((s) => s.pages.length);
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [mode, setMode] = useState<DocxMode>('layout');
  const [name, setName] = useState(docName || 'document');
  const [range, setRange] = useState('');
  const [error, setError] = useState<string | null>(null);

  const doExport = async () => {
    const st = useDoc.getState();
    let indices: number[];
    try {
      indices = parseRange(range, st.pages.length);
    } catch (e: any) {
      setError(e.message);
      return;
    }
    const pages = indices.map((i) => st.pages[i]);
    const file = name.trim() || 'document';
    onClose();
    await st.run('Exporting…', async () => {
      const progress = (done: number, total: number) =>
        useDoc.setState({ busy: `Exporting page ${Math.min(done + 1, total)} of ${total}…` });
      if (format === 'pdf') {
        const bytes = await exportPdf(pages, st.files, progress);
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${file}.pdf`);
      } else {
        const blob = await exportDocx(pages, st.files, mode, progress);
        downloadBlob(blob, `${file}.docx`);
      }
    });
  };

  return (
    <Modal
      title="Export"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={doExport}>
            Export {format.toUpperCase()}
          </button>
        </>
      }
    >
      <div className="format-cards">
        <button className={`format-card${format === 'pdf' ? ' on' : ''}`} onClick={() => setFormat('pdf')}>
          <FileText size={28} />
          <strong>PDF</strong>
          <span>All edits, drawings, pages &amp; cover</span>
        </button>
        <button className={`format-card${format === 'docx' ? ' on' : ''}`} onClick={() => setFormat('docx')}>
          <FileType2 size={28} />
          <strong>Word (DOCX)</strong>
          <span>Open and edit in Microsoft Word</span>
        </button>
      </div>

      {format === 'docx' && (
        <div className="field">
          <label>Word conversion</label>
          <label className="radio">
            <input type="radio" checked={mode === 'layout'} onChange={() => setMode('layout')} />
            <span>
              <strong>Keep exact layout</strong> — each page becomes a picture in Word (looks identical, text not editable)
            </span>
          </label>
          <label className="radio">
            <input type="radio" checked={mode === 'text'} onChange={() => setMode('text')} />
            <span>
              <strong>Editable text</strong> — extracts the text into normal Word paragraphs (formatting simplified, scanned
              pages have no text)
            </span>
          </label>
        </div>
      )}

      <div className="row2">
        <div className="field">
          <label>File name</label>
          <div className="suffix-input">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <span>.{format}</span>
          </div>
        </div>
        <div className="field">
          <label>Pages (blank = all {pageCount})</label>
          <input
            placeholder="e.g. 1-3, 5"
            value={range}
            onChange={(e) => {
              setRange(e.target.value);
              setError(null);
            }}
          />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
