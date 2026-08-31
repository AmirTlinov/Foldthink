import { WebMCPAdapter } from "@foldthink/agent-integration/browser";
import { AssetClient } from "@foldthink/asset/browser";
import {
  loadBlockEditor,
  loadDocumentRenderer,
  type BlockEditor,
  type DocumentEditRequest,
  type DocumentRenderer,
} from "@foldthink/document/browser";
import { consumeJoinCapability } from "@foldthink/identity/browser";
import {
  CanvasSceneRenderer,
  DrawingToolController,
  PointerIntentAdapter,
  SpatialWorkspaceController,
  ViewportController,
  type DrawingToolState,
  type SpatialViewState,
} from "@foldthink/interaction/browser";
import { LocalWorkspaceStore } from "@foldthink/local-persistence/browser";
import { SceneDocument, type WorkspaceItem } from "@foldthink/surface";
import { SyncClient } from "@foldthink/synchronization/browser";
import { WorkspaceRuntime } from "@foldthink/workspace";

export type WebRuntime = Readonly<{
  workspaceId: string;
  boardSurfaceId: string;
  runtime: WorkspaceRuntime;
  spatialState(): SpatialViewState;
  observeSpatial(listener: (state: SpatialViewState) => void): () => void;
  drawingToolState(): DrawingToolState;
  observeDrawingTool(listener: (state: DrawingToolState) => void): () => void;
  selectDrawingTool(tool: "pen" | "eraser"): void;
  setPenColor(color: string): void;
  setPenWidth(width: number): void;
  setMinimumOpacity(opacity: number): void;
  setEraserWidth(width: number): void;
  createItem(kind: "notebook" | "document"): Promise<void>;
  addPage(): Promise<void>;
  turnPage(direction: -1 | 1): Promise<void>;
  deleteSelected(): Promise<void>;
  closeItem(): void;
  destroy(): void;
}>;

export async function composeWebRuntime(
  canvas: HTMLCanvasElement,
  documentLayer: HTMLElement,
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
  const boardSurfaceId = "board";
  const scenes = loaded.surfaces.map((surface) => new SceneDocument(surface.surfaceId, surface.state));
  if (!scenes.some((scene) => scene.surfaceId === boardSurfaceId)) scenes.push(new SceneDocument(boardSurfaceId));
  const runtime = new WorkspaceRuntime(identity.workspaceId, scenes, store);
  const viewport = new ViewportController();
  const spatial = new SpatialWorkspaceController();
  const tools = new DrawingToolController();
  const renderer = new CanvasSceneRenderer(canvas, runtime.inspect(boardSurfaceId), viewport, spatial);
  for (const surfaceId of runtime.surfaceIds()) renderer.setSnapshot(runtime.inspect(surfaceId));
  const assets = new AssetClient(identity.workspaceId);
  let documentReadout: Promise<DocumentRenderer> | undefined;
  let documentEditor: Promise<BlockEditor> | undefined;
  let documentsDestroyed = false;
  const documentFailure = (): void => onStatus("Document tools could not be opened");
  const editDocument = (request: DocumentEditRequest): void => {
    documentEditor ??= loadBlockEditor().then((module) => {
      const editor = new module.BlockEditor({ runtime, assets, onStatus });
      if (documentsDestroyed) editor.destroy();
      return editor;
    });
    void documentEditor.then((editor) => {
      if (!documentsDestroyed) editor.open(request);
    }).catch(documentFailure);
  };
  const openDocuments = (): Promise<DocumentRenderer> => {
    documentReadout ??= loadDocumentRenderer().then((module) => {
      const documentRenderer = new module.DocumentRenderer({
        root: documentLayer,
        runtime,
        assets,
        latex: new module.LatexCompilationClient(identity.workspaceId),
        onEdit: editDocument,
        onStatus,
      });
      if (documentsDestroyed) documentRenderer.destroy();
      return documentRenderer;
    });
    return documentReadout;
  };
  const refreshDocument = (): void => {
    const documentViewport = renderer.documentViewport();
    if (!documentViewport) {
      void documentReadout?.then((documentRenderer) => documentRenderer.clear()).catch(documentFailure);
      return;
    }
    void openDocuments().then((documentRenderer) => {
      const currentViewport = renderer.documentViewport();
      documentRenderer.show(
        currentViewport ? runtime.inspect(currentViewport.surfaceId) : undefined,
        currentViewport,
      );
    }).catch(documentFailure);
  };
  const stopObserving = runtime.observeAll((snapshot) => {
    renderer.setSnapshot(snapshot);
    if (snapshot.surfaceId === boardSurfaceId) {
      const state = spatial.state();
      const selectedItemId = spatial.selectedItemId();
      if (selectedItemId && !renderer.item(selectedItemId)) {
        if (state.mode !== "board") spatial.close();
        spatial.select();
      }
    }
    refreshDocument();
    onStatus("Saved on this device");
  });
  const stopDocumentSpatialObservation = spatial.observe(refreshDocument);
  const documentResizeObserver = new ResizeObserver(refreshDocument);
  documentResizeObserver.observe(canvas);

  const turnPage = async (direction: -1 | 1): Promise<void> => {
    const itemId = spatial.selectedItemId();
    const item = itemId ? renderer.item(itemId) : undefined;
    if (!item) return;
    const activePageIndex = Math.max(0, Math.min(item.pageSurfaceIds.length - 1, item.activePageIndex + direction));
    if (activePageIndex === item.activePageIndex) return;
    await runtime.dispatch({
      kind: "patchSurface",
      surfaceId: boardSurfaceId,
      changes: [{
        action: "put",
        expectedVersion: item.version,
        element: { ...item, activePageIndex },
      }],
    });
  };
  const pointerAdapter = new PointerIntentAdapter({
    canvas,
    boardSurfaceId,
    runtime,
    renderer,
    viewport,
    spatial,
    tools,
    onPageTurn: (direction) => void turnPage(direction).catch(() => onStatus("This page turn could not be saved")),
    onSurfaceDoubleTap: (target) => {
      void openDocuments().then((documentRenderer) => {
        if (renderer.activeSurfaceId() === target.surfaceId) documentRenderer.editAt(target.point);
      }).catch(documentFailure);
    },
    onCommitError: () => onStatus("This mark could not be saved"),
  });
  const sync = new SyncClient({
    runtime,
    store,
    identity,
    onStatus(status): void {
      if (status === "connecting") onStatus("Connecting this surface");
      else if (status === "shared") onStatus("Shared");
      else if (status === "rejected") onStatus("A rejected change was repaired safely");
      else onStatus("Saved locally, waiting to share");
    },
  });
  const webmcp = new WebMCPAdapter(() => ({
    runtime,
    visibleSurfaceId: renderer.activeSurfaceId(),
    authorizeEdit: (signal) => sync.authorizeEdit(signal),
    committedRevision: (requestedSurfaceId) => sync.surfaceRevision(requestedSurfaceId),
    waitForCommittedReceipt: (operationId, timeoutMilliseconds, signal) =>
      sync.waitForCommittedReceipt(operationId, timeoutMilliseconds, signal),
  }));
  void webmcp.register().catch(() => undefined);
  sync.start();
  refreshDocument();

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register(
      `/sw.js?revision=${encodeURIComponent(import.meta.env.VITE_REVISION)}`,
    );
  }
  onStatus(loaded.outbox.length > 0 ? "Saved locally, waiting to share" : "Ready");

  return Object.freeze({
    workspaceId: identity.workspaceId,
    boardSurfaceId,
    runtime,
    spatialState: () => spatial.state(),
    observeSpatial: (listener) => spatial.observe(listener),
    drawingToolState: () => tools.state(),
    observeDrawingTool: (listener) => tools.observe(listener),
    selectDrawingTool: (tool) => tools.select(tool),
    setPenColor: (color) => tools.setPenColor(color),
    setPenWidth: (width) => tools.setPenWidth(width),
    setMinimumOpacity: (opacity) => tools.setMinimumOpacity(opacity),
    setEraserWidth: (width) => tools.setEraserMaximumWidth(width),
    async createItem(kind): Promise<void> {
      const itemId = crypto.randomUUID();
      const coverSurfaceId = `cover:${itemId}`;
      const firstPageSurfaceId = `${kind === "document" ? "document" : "page"}:${itemId}:1`;
      const bounds = canvas.getBoundingClientRect();
      const center = viewport.screenToWorld({ x: bounds.width / 2, y: bounds.height / 2 });
      const width = kind === "document" ? 420 : 360;
      const height = kind === "document" ? 560 : 504;
      const topZ = renderer.items().reduce((maximum, item) => Math.max(maximum, item.z), 0) + 1;
      const item: WorkspaceItem = {
        id: itemId,
        kind: "item",
        version: 1,
        itemKind: kind,
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height,
        z: topZ,
        coverSurfaceId,
        pageSurfaceIds: [firstPageSurfaceId],
        activePageIndex: 0,
        stackOrder: 0,
      };
      await runtime.dispatch({
        kind: "createSurfaces",
        patches: [{
          surfaceId: boardSurfaceId,
          changes: [{ action: "put", element: item }],
        }],
        surfaces: [
          { surfaceId: coverSurfaceId, changes: [] },
          { surfaceId: firstPageSurfaceId, changes: [] },
        ],
      });
      spatial.select(itemId);
    },
    async addPage(): Promise<void> {
      const itemId = spatial.selectedItemId();
      const item = itemId ? renderer.item(itemId) : undefined;
      if (!item) return;
      const pageSurfaceId = `${item.itemKind === "document" ? "document" : "page"}:${item.id}:${crypto.randomUUID()}`;
      await runtime.dispatch({
        kind: "createSurfaces",
        patches: [{
          surfaceId: boardSurfaceId,
          changes: [{
            action: "put",
            expectedVersion: item.version,
            element: {
              ...item,
              pageSurfaceIds: [...item.pageSurfaceIds, pageSurfaceId],
              activePageIndex: item.pageSurfaceIds.length,
            },
          }],
        }],
        surfaces: [{ surfaceId: pageSurfaceId, changes: [] }],
      });
    },
    async turnPage(direction): Promise<void> {
      await turnPage(direction);
    },
    async deleteSelected(): Promise<void> {
      const itemId = spatial.selectedItemId();
      const item = itemId ? renderer.item(itemId) : undefined;
      if (!item) return;
      await runtime.dispatch({
        kind: "patchSurface",
        surfaceId: boardSurfaceId,
        changes: [{ action: "delete", elementId: item.id, expectedVersion: item.version }],
      });
      spatial.close();
      spatial.select();
    },
    closeItem(): void {
      spatial.close();
    },
    destroy(): void {
      sync.stop();
      void webmcp.destroy().catch(() => undefined);
      stopObserving();
      stopDocumentSpatialObservation();
      documentResizeObserver.disconnect();
      documentsDestroyed = true;
      void documentEditor?.then((editor) => editor.destroy()).catch(() => undefined);
      void documentReadout?.then((documentRenderer) => documentRenderer.destroy()).catch(() => undefined);
      pointerAdapter.destroy();
      renderer.destroy();
      store.close();
    },
  });
}
