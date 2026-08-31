import type { SceneElement } from "./scene-element.js";

export type SurfaceSnapshot = Readonly<{
  surfaceId: string;
  elements: readonly SceneElement[];
  stateVector: Uint8Array;
}>;

export type SurfaceMutation = Readonly<{
  surfaceId: string;
  changedIds: readonly string[];
  update: Uint8Array;
  state: Uint8Array;
  snapshot: SurfaceSnapshot;
}>;

export type AppliedSurfaceUpdate = Readonly<{
  surfaceId: string;
  changedIds: readonly string[];
  snapshot: SurfaceSnapshot;
}>;
