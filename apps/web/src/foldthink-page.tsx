import { useEffect, useRef, useState } from "react";
import type { DrawingToolState, SpatialViewState } from "@foldthink/interaction/browser";
import { composeWebRuntime, type WebRuntime } from "./compose-web-runtime.js";

export function FoldthinkPage(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentLayerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<WebRuntime | undefined>(undefined);
  const [status, setStatus] = useState("Opening local surface");
  const [spatial, setSpatial] = useState<SpatialViewState>({ mode: "board" });
  const [creating, setCreating] = useState(false);
  const [toolPanel, setToolPanel] = useState(false);
  const [drawingTool, setDrawingTool] = useState<DrawingToolState>();

  useEffect(() => {
    const canvas = canvasRef.current;
    const documentLayer = documentLayerRef.current;
    if (!canvas || !documentLayer) return;
    let destroyed = false;
    let destroy: (() => void) | undefined;
    let stopSpatial: (() => void) | undefined;
    let stopDrawingTool: (() => void) | undefined;
    void composeWebRuntime(canvas, documentLayer, setStatus)
      .then((runtime) => {
        if (destroyed) {
          runtime.destroy();
          return;
        }
        runtimeRef.current = runtime;
        setSpatial(runtime.spatialState());
        stopSpatial = runtime.observeSpatial(setSpatial);
        setDrawingTool(runtime.drawingToolState());
        stopDrawingTool = runtime.observeDrawingTool(setDrawingTool);
        destroy = runtime.destroy;
      })
      .catch(() => setStatus("Foldthink could not open this surface"));
    return () => {
      destroyed = true;
      stopSpatial?.();
      stopDrawingTool?.();
      destroy?.();
      runtimeRef.current = undefined;
    };
  }, []);

  const create = async (kind: "notebook" | "document"): Promise<void> => {
    setCreating(false);
    try {
      await runtimeRef.current?.createItem(kind);
    } catch {
      setStatus("This item could not be created");
    }
  };

  const selected = spatial.mode === "board" && Boolean(spatial.selectedItemId);
  const insideItem = spatial.mode === "item";

  return (
    <main className="surface-shell">
      <canvas
        ref={canvasRef}
        className="thinking-surface"
        aria-label="Foldthink shared surface"
        onPointerDown={() => {
          setCreating(false);
          setToolPanel(false);
        }}
      />
      <div ref={documentLayerRef} className="foldthink-document-layer" />

      <nav className="surface-actions" aria-label="Workspace actions">
        {insideItem ? (
          <>
            <button
              type="button"
              className="round-action"
              aria-label="Return to board"
              onClick={() => runtimeRef.current?.closeItem()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 4H4v5m11-5h5v5m0 6v5h-5M9 20H4v-5" />
              </svg>
            </button>
            <button
              type="button"
              className="round-action"
              aria-label="Previous page"
              onClick={() => void runtimeRef.current?.turnPage(-1).catch(() => setStatus("This page turn could not be saved"))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 7-5 5 5 5" /></svg>
            </button>
            <button
              type="button"
              className="round-action"
              aria-label="Add page"
              onClick={() => void runtimeRef.current?.addPage().catch(() => setStatus("This page could not be created"))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h8l3 3v13H7zM15 4v4h4M12.5 11v6M9.5 14h6" /></svg>
            </button>
            <button
              type="button"
              className="round-action"
              aria-label="Next page"
              onClick={() => void runtimeRef.current?.turnPage(1).catch(() => setStatus("This page turn could not be saved"))}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 7 5 5-5 5" /></svg>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="round-action"
              aria-label="Create an item"
              aria-expanded={creating}
              onClick={() => setCreating((visible) => !visible)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            {creating && (
              <div className="creation-choices">
                <button type="button" onClick={() => void create("notebook")}>Notebook</button>
                <button type="button" onClick={() => void create("document")}>Document</button>
              </div>
            )}
            {selected && (
              <button
                type="button"
                className="round-action delete-action"
                aria-label="Delete selected item"
                onClick={() => void runtimeRef.current?.deleteSelected()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" />
                </svg>
              </button>
            )}
          </>
        )}
      </nav>

      <nav className="drawing-actions" aria-label="Drawing tools">
        <button
          type="button"
          className="round-action"
          aria-label="Drawing tools"
          aria-expanded={toolPanel}
          aria-controls="drawing-tool-panel"
          onClick={() => setToolPanel((visible) => !visible)}
        >
          {drawingTool?.selected === "eraser" ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7 17 9.5-9.5 3 3L10 20H6l-2-2 3-3m7 2 3 3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 19 3.4-.8L19 7.6 16.4 5 5.8 15.6 5 19Zm9.7-12.3 2.6 2.6" />
            </svg>
          )}
        </button>
        {toolPanel && drawingTool && (
          <section id="drawing-tool-panel" className="tool-panel" aria-label="Drawing tool settings">
            <div className="tool-choice" aria-label="Active drawing tool">
              <button
                type="button"
                aria-pressed={drawingTool.selected === "pen"}
                onClick={() => runtimeRef.current?.selectDrawingTool("pen")}
              >
                Pen
              </button>
              <button
                type="button"
                aria-pressed={drawingTool.selected === "eraser"}
                onClick={() => runtimeRef.current?.selectDrawingTool("eraser")}
              >
                Eraser
              </button>
            </div>
            {drawingTool.selected === "pen" ? (
              <>
                <label className="tool-row color-row" htmlFor="pen-color">
                  <span>Color</span>
                  <input
                    id="pen-color"
                    type="color"
                    value={drawingTool.pen.color}
                    onChange={(event) => runtimeRef.current?.setPenColor(event.currentTarget.value)}
                  />
                </label>
                <label className="tool-row" htmlFor="pen-width">
                  <span>Width <output aria-hidden="true">{drawingTool.pen.width.toFixed(1)}</output></span>
                  <input
                    id="pen-width"
                    type="range"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={drawingTool.pen.width}
                    onChange={(event) => runtimeRef.current?.setPenWidth(event.currentTarget.valueAsNumber)}
                  />
                </label>
                <label className="tool-row" htmlFor="pen-minimum-opacity">
                  <span>Lightest pressure <output aria-hidden="true">{Math.round(drawingTool.pen.minimumOpacity * 100)}%</output></span>
                  <input
                    id="pen-minimum-opacity"
                    type="range"
                    min="0.02"
                    max="0.9"
                    step="0.01"
                    value={drawingTool.pen.minimumOpacity}
                    onChange={(event) => runtimeRef.current?.setMinimumOpacity(event.currentTarget.valueAsNumber)}
                  />
                </label>
              </>
            ) : (
              <label className="tool-row" htmlFor="eraser-size">
                <span>Size <output aria-hidden="true">{Math.round(drawingTool.eraser.maximumWidth)}</output></span>
                <input
                  id="eraser-size"
                  type="range"
                  min="12"
                  max="240"
                  step="2"
                  value={drawingTool.eraser.maximumWidth}
                  onChange={(event) => runtimeRef.current?.setEraserWidth(event.currentTarget.valueAsNumber)}
                />
              </label>
            )}
          </section>
        )}
      </nav>

      <output className="surface-status" aria-live="polite">
        <span aria-hidden="true" />
        {status}
      </output>
    </main>
  );
}
