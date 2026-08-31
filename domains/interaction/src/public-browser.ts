export { CanvasSceneRenderer } from "./canvas-scene-renderer.js";
export type { SurfaceTarget, SurfaceViewport } from "./canvas-scene-renderer.js";
export { GestureArena } from "./gesture-arena.js";
export type { GestureUpdate } from "./gesture-arena.js";
export { DrawingToolController } from "./drawing-tool-controller.js";
export type { DrawingToolState } from "./drawing-tool-controller.js";
export { EraseSession } from "./erase-session.js";
export { eraserWidthAtPressure, inkOpacityAtPressure, inkWidthAtPressure } from "./ink-geometry.js";
export { InkSpatialIndex } from "./ink-spatial-index.js";
export type { EraseGeometry } from "./ink-spatial-index.js";
export { InkSession } from "./ink-session.js";
export type { InkSample } from "./ink-session.js";
export { PointerIntentAdapter } from "./pointer-intent-adapter.js";
export type { PointerAdapterOptions } from "./pointer-intent-adapter.js";
export { SpatialWorkspaceController } from "./spatial-workspace-controller.js";
export type { ItemMovePreview, SpatialViewState } from "./spatial-workspace-controller.js";
export {
  boardPointInItem,
  itemAtWorld,
  pageSize,
  pageTransform,
  screenToPage,
} from "./surface-coordinate-map.js";
export type { SurfaceTransform } from "./surface-coordinate-map.js";
export { ViewportController } from "./viewport-controller.js";
export type { ScreenPoint, ViewportState } from "./viewport-controller.js";
export { arrangeWorkspaceItemDrop } from "./workspace-item-arrangement.js";
export type { WorkspaceItemDrop } from "./workspace-item-arrangement.js";
