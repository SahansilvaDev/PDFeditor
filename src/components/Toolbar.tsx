import {
  ArrowUpRight,
  Circle,
  Delete,
  Eraser,
  Highlighter,
  ImagePlus,
  Maximize,
  Minus,
  MousePointer2,
  Pen,
  Redo2,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  Baseline,
  type LucideIcon,
} from 'lucide-react';
import { useDoc } from '../lib/store';
import { editorBridge } from '../lib/bridge';
import { FONTS, IMAGE_ACCEPT, pickFiles, readAsDataURL } from '../lib/util';
import type { Style, Tool } from '../lib/types';

const TOOL_GROUPS: { id: Tool; label: string; icon: LucideIcon }[][] = [
  [{ id: 'select', label: 'Select / move (Esc)', icon: MousePointer2 }],
  [
    { id: 'editText', label: 'Edit existing text', icon: TextCursorInput },
    { id: 'text', label: 'Add text', icon: Type },
    { id: 'whiteout', label: 'Whiteout (cover content)', icon: Eraser },
    { id: 'highlight', label: 'Highlight area', icon: Baseline },
  ],
  [
    { id: 'pen', label: 'Pen (free drawing)', icon: Pen },
    { id: 'highlighter', label: 'Highlighter pen', icon: Highlighter },
    { id: 'rect', label: 'Rectangle', icon: Square },
    { id: 'ellipse', label: 'Ellipse', icon: Circle },
    { id: 'line', label: 'Line', icon: Minus },
    { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  ],
  [{ id: 'eraser', label: 'Delete objects by clicking', icon: Delete }],
];

export function Toolbar() {
  const tool = useDoc((s) => s.tool);
  const style = useDoc((s) => s.style);
  const zoom = useDoc((s) => s.zoom);
  const { setTool, setStyle, setZoom } = useDoc.getState();

  const change = (patch: Partial<Style>) => {
    setStyle(patch);
    editorBridge.current?.applyStyle(patch);
  };

  const addImage = async () => {
    const [file] = await pickFiles(IMAGE_ACCEPT, false);
    if (file) await editorBridge.current?.addImage(await readAsDataURL(file));
  };

  return (
    <div className="toolbar">
      {TOOL_GROUPS.map((group, gi) => (
        <div className="tool-group" key={gi}>
          {group.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`icon-btn${tool === id ? ' active' : ''}`}
              title={label}
              onClick={() => setTool(id)}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      ))}
      <div className="tool-group">
        <button className="icon-btn" title="Insert image / signature" onClick={addImage}>
          <ImagePlus size={18} />
        </button>
      </div>

      <div className="tool-group props">
        <label className="swatch" title="Colour (text, pen, shape outline)">
          <input type="color" value={style.color} onChange={(e) => change({ color: e.target.value })} />
        </label>
        <label className="check" title="Fill shapes">
          <input type="checkbox" checked={style.fillEnabled} onChange={(e) => change({ fillEnabled: e.target.checked })} />
          Fill
        </label>
        {style.fillEnabled && (
          <label className="swatch" title="Fill colour">
            <input type="color" value={style.fill} onChange={(e) => change({ fill: e.target.value })} />
          </label>
        )}
        <label className="swatch hl" title="Highlight colour">
          <input type="color" value={style.highlightColor} onChange={(e) => change({ highlightColor: e.target.value })} />
        </label>
        <select
          title="Line width"
          value={style.strokeWidth}
          onChange={(e) => change({ strokeWidth: Number(e.target.value) })}
        >
          {[1, 2, 3, 5, 8, 12, 20].map((w) => (
            <option key={w} value={w}>
              {w} pt
            </option>
          ))}
        </select>
        <select title="Font" value={style.fontFamily} onChange={(e) => change({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <input
          className="num"
          type="number"
          min={4}
          max={200}
          title="Font size"
          value={style.fontSize}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 4 && v <= 200) change({ fontSize: v });
          }}
        />
      </div>

      <div className="tool-group">
        <button className="icon-btn" title="Undo (Ctrl+Z)" onClick={() => editorBridge.current?.undo()}>
          <Undo2 size={18} />
        </button>
        <button className="icon-btn" title="Redo (Ctrl+Y)" onClick={() => editorBridge.current?.redo()}>
          <Redo2 size={18} />
        </button>
        <button className="icon-btn" title="Delete selected (Del)" onClick={() => editorBridge.current?.deleteSelected()}>
          <Trash2 size={18} />
        </button>
      </div>

      <div className="tool-group zoom">
        <button className="icon-btn" title="Zoom out" onClick={() => setZoom(zoom / 1.2)}>
          <ZoomOut size={18} />
        </button>
        <span className="zoom-val">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" title="Zoom in" onClick={() => setZoom(zoom * 1.2)}>
          <ZoomIn size={18} />
        </button>
        <button className="icon-btn" title="Fit to window" onClick={() => editorBridge.current?.fitWidth()}>
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
}
