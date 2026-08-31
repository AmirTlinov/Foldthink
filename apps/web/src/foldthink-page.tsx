import { useEffect, useRef, useState } from "react";
import type { SpatialViewState } from "@foldthink/interaction/browser";
import { composeWebRuntime, type WebRuntime } from "./compose-web-runtime.js";

export function FoldthinkPage(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<WebRuntime | undefined>(undefined);
  const [status, setStatus] = useState("Opening local surface");
  const [spatial, setSpatial] = useState<SpatialViewState>({ mode: "board" });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let destroyed = false;
    let destroy: (() => void) | undefined;
    let stopSpatial: (() => void) | undefined;
    void composeWebRuntime(canvas, setStatus)
      .then((runtime) => {
        if (destroyed) {
          runtime.destroy();
          return;
        }
        runtimeRef.current = runtime;
        setSpatial(runtime.spatialState());
        stopSpatial = runtime.observeSpatial(setSpatial);
        destroy = runtime.destroy;
      })
      .catch(() => setStatus("Foldthink could not open this surface"));
    return () => {
      destroyed = true;
      stopSpatial?.();
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
        onPointerDown={() => setCreating(false)}
      />

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

      <output className="surface-status" aria-live="polite">
        <span aria-hidden="true" />
        {status}
      </output>
    </main>
  );
}
