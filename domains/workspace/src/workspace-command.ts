import type { InkStroke, SceneChange } from "@foldthink/surface";

export type CommitStrokeIntent = Readonly<{
  kind: "commitStroke";
  surfaceId: string;
  stroke: InkStroke;
}>;

export type PatchSurfaceIntent = Readonly<{
  kind: "patchSurface";
  surfaceId: string;
  changes: readonly SceneChange[];
}>;

export type CreateSurfacesIntent = Readonly<{
  kind: "createSurfaces";
  surfaces: readonly Readonly<{
    surfaceId: string;
    changes: readonly SceneChange[];
  }>[];
}>;

export type CommandIntent = CommitStrokeIntent | PatchSurfaceIntent | CreateSurfacesIntent;

export type SurfaceOperationUpdate = Readonly<{
  surfaceId: string;
  payload: Uint8Array;
}>;

export type LocalOperation = Readonly<{
  protocolVersion: 1;
  operationId: string;
  workspaceId: string;
  intent: CommandIntent;
  updates: readonly SurfaceOperationUpdate[];
}>;
