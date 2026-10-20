import type { Style } from './types';

/** Imperative API exposed by the mounted editor canvas to toolbars and dialogs. */
export interface EditorApi {
  undo(): void;
  redo(): void;
  deleteSelected(): void;
  applyStyle(patch: Partial<Style>): void;
  addImage(dataUrl: string): Promise<void>;
  fitWidth(): void;
  /** Finishes any in-progress text editing so it is saved. */
  commit(): void;
}

export const editorBridge: { current: EditorApi | null } = { current: null };
