import { WebMCPAdapter } from "@foldthink/agent-integration/browser";
import { consumeJoinCapability } from "@foldthink/identity/browser";
import {
  CanvasSceneRenderer,
  PointerIntentAdapter,
  ViewportController,
} from "@foldthink/interaction/browser";
import { LocalWorkspaceStore } from "@foldthink/local-persistence/browser";
import { SceneDocument } from "@foldthink/surface";
import { SyncClient } from "@foldthink/synchronization/browser";
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
  let identity = await store.getOrCreateIdentity();
  const joinToken = new URLSearchParams(location.hash.slice(1)).get("join");
  if (joinToken) {
    const current = await store.loadWorkspace(identity);
    if (current.surfaces.length > 0 || current.outbox.length > 0 || current.receipts.length > 0) {
      throw new Error("This device already owns local Foldthink work.");
    }
    onStatus("Linking this surface");
    const linkedSession = await consumeJoinCapability(joinToken);
    identity = await store.adoptLinkedWorkspace(identity, linkedSession.workspaceId);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
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
  const sync = new SyncClient({
    runtime,
    store,
    identity,
    onStatus(status): void {
      if (status === "connecting") onStatus("Connecting this surface");
      else if (status === "shared") onStatus("Shared");
      else if (status === "rejected") onStatus("This surface needs a safe reload");
      else onStatus("Saved locally, waiting to share");
    },
  });
  sync.start();

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
      sync.stop();
      void webmcp.destroy().catch(() => undefined);
      stopObserving();
      pointerAdapter.destroy();
      renderer.destroy();
      store.close();
    },
  });
}
