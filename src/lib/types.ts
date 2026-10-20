import type { PDFDocumentProxy } from './pdfjs';

export type Tool =
  | 'select'
  | 'text'
  | 'editText'
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'highlight'
  | 'whiteout'
  | 'eraser';

/** A loaded source PDF. `bytes` is kept untouched for pdf-lib; pdf.js gets its own copy. */
export interface SourceFile {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
}

export type PageSource = { kind: 'pdf'; fileId: string; index: number } | { kind: 'blank' };

/** Fabric canvas JSON (output of canvas.toObject). Coordinates are PDF points in the rotated view. */
export type OverlayJSON = { objects?: any[]; [key: string]: any };

export interface Page {
  id: string;
  source: PageSource;
  /** Unrotated page size in PDF points. */
  width: number;
  height: number;
  /** Rotation stored in the source PDF. */
  baseRotation: number;
  /** Extra rotation applied in the editor (multiple of 90). */
  rotation: number;
  overlay: OverlayJSON | null;
  /** Background colour for blank / cover pages. */
  bgColor: string | null;
}

export interface Style {
  color: string;
  fill: string;
  fillEnabled: boolean;
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
  highlightColor: string;
}
