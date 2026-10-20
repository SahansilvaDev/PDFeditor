import { useEffect, useState } from 'react';
import { Download, FolderOpen, Loader2, Merge, BookOpen } from 'lucide-react';
import { useDoc } from './lib/store';
import { editorBridge } from './lib/bridge';
import { PDF_ACCEPT, pickFiles } from './lib/util';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { CoverDialog } from './components/CoverDialog';
import { MergeDialog } from './components/MergeDialog';
import { ExportDialog } from './components/ExportDialog';
import { Home } from './components/Home';
import { Modal } from './components/Modal';
import iconUrl from './assets/icon.png';

type Dialog = 'cover' | 'merge' | 'export' | 'home' | null;

export default function App() {
  const hasDoc = useDoc((s) => s.pages.length > 0);
  const busy = useDoc((s) => s.busy);
  const docName = useDoc((s) => s.docName);
  const st = useDoc.getState();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dropping, setDropping] = useState(false);

  const openPdf = async () => {
    const files = await pickFiles(PDF_ACCEPT, true);
    if (files.length) await st.run('Opening…', () => st.openFiles(files, 'replace'));
  };

  const openExport = () => {
    editorBridge.current?.commit();
    setDialog('export');
  };

  const goHome = () => {
    st.closeDocument();
    setDialog(null);
  };

  // Drag & drop PDFs / images anywhere: opens them, or appends when a document is open.
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth++;
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      if (--depth <= 0) setDropping(false);
    };
    const over = (e: DragEvent) => isFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const files = Array.from(e.dataTransfer!.files);
      const s = useDoc.getState();
      if (files.length) s.run('Opening…', () => s.openFiles(files, s.pages.length ? 'append' : 'replace'));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (useDoc.getState().pages.length) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return (
    <div className="app">
      {hasDoc ? (
        <>
          <header className="topbar">
            <button
              className="brand"
              title="Back to home"
              onClick={() => {
                editorBridge.current?.commit();
                setDialog('home');
              }}
            >
              <img src={iconUrl} alt="" className="brand-icon" />
              <span>PDF Studio</span>
            </button>
            <input
              className="doc-name"
              value={docName}
              onChange={(e) => st.setDocName(e.target.value)}
              title="Document name"
            />
            <div className="top-actions">
              <button className="btn ghost" onClick={openPdf}>
                <FolderOpen size={16} /> <span>Open</span>
              </button>
              <button className="btn ghost" onClick={() => setDialog('merge')}>
                <Merge size={16} /> <span>Merge PDFs</span>
              </button>
              <button className="btn ghost" onClick={() => setDialog('cover')}>
                <BookOpen size={16} /> <span>Add cover</span>
              </button>
              <button className="btn primary" onClick={openExport}>
                <Download size={16} /> Export
              </button>
            </div>
          </header>
          <Toolbar />
          <div className="main">
            <Sidebar onCover={() => setDialog('cover')} />
            <Editor />
          </div>
        </>
      ) : (
        <Home
          onOpen={openPdf}
          onMerge={() => setDialog('merge')}
          onCover={() => setDialog('cover')}
          onBlank={() => st.newBlankDocument()}
        />
      )}

      {dialog === 'cover' && <CoverDialog onClose={() => setDialog(null)} />}
      {dialog === 'merge' && <MergeDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'home' && (
        <Modal
          title="Go back to the home screen?"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                Stay here
              </button>
              <button className="btn" onClick={() => setDialog('export')}>
                <Download size={16} /> Export first
              </button>
              <button className="btn danger" onClick={goHome}>
                Go to home
              </button>
            </>
          }
        >
          <div className="confirm-home">
            <img src={iconUrl} alt="" />
            <p>
              The document <strong>“{docName}”</strong> will be closed and any changes you have not exported will be
              lost.
            </p>
          </div>
        </Modal>
      )}

      {dropping && <div className="drop-overlay">Drop PDF or image files to {hasDoc ? 'add them' : 'open them'}</div>}
      {busy && (
        <div className="busy">
          <Loader2 className="spin" size={18} /> {busy}
        </div>
      )}
    </div>
  );
}
