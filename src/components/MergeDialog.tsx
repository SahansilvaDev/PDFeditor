import { useState } from 'react';
import { ArrowDown, ArrowUp, FileText, Plus, X } from 'lucide-react';
import { Modal } from './Modal';
import { useDoc } from '../lib/store';
import { mergePdfFiles } from '../lib/exportPdf';
import { PDF_ACCEPT, downloadBlob, pickFiles, uid } from '../lib/util';

interface Item {
  id: string;
  file: File;
}

const fmtSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function MergeDialog({ onClose }: { onClose: () => void }) {
  const hasDoc = useDoc((s) => s.pages.length > 0);
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState('merged');

  const add = async () => {
    const files = await pickFiles(PDF_ACCEPT, true);
    setItems((it) => [...it, ...files.map((file) => ({ id: uid(), file }))]);
  };
  const move = (i: number, d: number) =>
    setItems((it) => {
      const next = [...it];
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x);
      return next;
    });

  const st = useDoc.getState();
  const files = () => items.map((i) => i.file);

  const download = async () => {
    await st.run('Merging PDFs…', async () => {
      const bytes = await mergePdfFiles(files());
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${name || 'merged'}.pdf`);
    });
    onClose();
  };
  const open = async (mode: 'replace' | 'append') => {
    await st.run('Merging PDFs…', async () => {
      await st.openFiles(files(), mode);
      if (mode === 'replace') st.setDocName(name || 'merged');
    });
    onClose();
  };

  const ready = items.length >= 1;

  return (
    <Modal
      title="Combine PDFs into one"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {hasDoc && (
            <button className="btn" disabled={!ready} onClick={() => open('append')}>
              Append to current
            </button>
          )}
          <button className="btn" disabled={!ready} onClick={() => open('replace')}>
            Open merged in editor
          </button>
          <button className="btn primary" disabled={items.length < 2} onClick={download}>
            Merge &amp; download
          </button>
        </>
      }
    >
      <p className="muted">Add PDF files and put them in the order you want. Pages are combined top to bottom.</p>
      <div className="merge-list">
        {items.map((it, i) => (
          <div className="merge-item" key={it.id}>
            <span className="merge-idx">{i + 1}</span>
            <FileText size={18} />
            <span className="merge-name" title={it.file.name}>
              {it.file.name}
            </span>
            <span className="muted small">{fmtSize(it.file.size)}</span>
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
              <ArrowUp size={16} />
            </button>
            <button className="icon-btn" disabled={i === items.length - 1} onClick={() => move(i, 1)} title="Move down">
              <ArrowDown size={16} />
            </button>
            <button className="icon-btn" onClick={() => setItems((x) => x.filter((y) => y.id !== it.id))} title="Remove">
              <X size={16} />
            </button>
          </div>
        ))}
        <button className="merge-add" onClick={add}>
          <Plus size={18} /> Add PDF files
        </button>
      </div>
      <div className="field">
        <label>File name for download</label>
        <div className="suffix-input">
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <span>.pdf</span>
        </div>
      </div>
    </Modal>
  );
}
