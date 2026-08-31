export {
  SceneConflictError,
  SceneValidationError,
  validateSceneElement,
} from "./scene-element.js";
export type {
  AssetBlock,
  InkStroke,
  InkStyle,
  EraseMask,
  EraserStyle,
  LatexBlock,
  MarkdownBlock,
  SceneChange,
  SceneElement,
  ScenePoint,
  ShapeElement,
  WidgetBlock,
  WidgetState,
  WorkspaceItem,
} from "./scene-element.js";
export { inspectSurfaceTransition, SceneDocument } from "./scene-document.js";
export type {
  AppliedSurfaceUpdate,
  SurfaceMutation,
  SurfaceSnapshot,
} from "./surface-snapshot.js";
