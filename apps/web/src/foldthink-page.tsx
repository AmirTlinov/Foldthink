import { useEffect, useRef, useState } from "react";
import { composeWebRuntime } from "./compose-web-runtime.js";

export function FoldthinkPage(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Opening local surface");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let destroyed = false;
    let destroy: (() => void) | undefined;
    void composeWebRuntime(canvas, setStatus)
      .then((runtime) => {
        if (destroyed) runtime.destroy();
        else destroy = runtime.destroy;
      })
      .catch(() => setStatus("Foldthink could not open local storage"));
    return () => {
      destroyed = true;
      destroy?.();
    };
  }, []);

  return (
    <main className="surface-shell">
      <canvas ref={canvasRef} className="thinking-surface" aria-label="Foldthink shared surface" />
      <output className="surface-status" aria-live="polite">
        <span aria-hidden="true" />
        {status}
      </output>
    </main>
  );
}
