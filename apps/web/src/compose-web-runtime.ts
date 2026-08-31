import { WebMCPAdapter } from "@foldthink/agent-integration/browser";
import {
  CanvasSceneRenderer,
  PointerIntentAdapter,
  ViewportController,
} from "@foldthink/interaction/browser";
import { LocalWorkspaceStore } from "@foldthink/local-persistence/browser";
import { SceneDocument } from "@foldthink/surface";
import { WorkspaceRuntime } from "@foldthink/workspace";

export type WebRuntime = Readonly<{
  workspaceId: string;
  surfaceId: string;
  runtime: WorkspaceRuntime;
  destroy(): void;
}>;

export async function composeWebRuntime(
  canvas: HTMLCanvasElement,
  onStatus: (status: string) => void,
): Promise<WebRuntime> {
  onStatus("Opening local surface");
  const store = await LocalWorkspaceStore.open(indexedDB, () => {
    onStatus("A newer Foldthink version is ready. Reloading safely.");
    window.location.reload();
  });
  const identity = await store.getOrCreateIdentity();
  const loaded = await store.loadWorkspace(identity);
  const surfaceId = "board";
  const savedSurface = loaded.surfaces.find((surface) => surface.surfaceId === surfaceId);
  const scene = new SceneDocument(surfaceId, savedSurface?.state);
  const runtime = new WorkspaceRuntime(identity.workspaceId, [scene], store);
  const viewport = new ViewportController();
  const renderer = new CanvasSceneRenderer(canvas, scene.snapshot(), viewport);
  const stopObserving = runtime.observe(surfaceId, (snapshot) => {
    renderer.setSnapshot(snapshot);
    onStatus("Saved on this device");
  });
  const pointerAdapter = new PointerIntentAdapter({
    canvas,
    surfaceId,
    runtime,
    renderer,
    viewport,
    onCommitError: () => onStatus("This stroke is visible but could not be saved"),
  });
  const webmcp = new WebMCPAdapter(() => ({
    runtime,
    visibleSurfaceId: surfaceId,
  }));
  void webmcp.register().catch(() => undefined);

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register(
      `/sw.js?revision=${encodeURIComponent(import.meta.env.VITE_REVISION)}`,
    );
  }
  onStatus(loaded.outbox.length > 0 ? "Saved locally, waiting to share" : "Ready");

  return Object.freeze({
    workspaceId: identity.workspaceId,
    surfaceId,
    runtime,
    destroy(): void {
      void webmcp.destroy().catch(() => undefined);
      stopObserving();
      pointerAdapter.destroy();
      renderer.destroy();
      store.close();
    },
  });
}
