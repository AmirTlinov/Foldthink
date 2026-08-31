import { validateSceneElement } from "@foldthink/surface";
import type { CommandReceipt, WorkspaceRuntime } from "@foldthink/workspace";
import { parseSurfacePatchInput } from "./site-tool-schema.js";

export async function applySurfacePatch(
  runtime: WorkspaceRuntime,
  visibleSurfaceId: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<CommandReceipt> {
  signal?.throwIfAborted();
  const patch = parseSurfacePatchInput(input);
  for (const change of patch.changes) {
    if (change.action === "put") {
      if (change.element.kind === "item") {
        throw new TypeError("Workspace items are created with their cover and page surfaces as one structural command.");
      }
      validateSceneElement(change.element);
    }
  }
  const receipt = await runtime.dispatch(
    {
      kind: "patchSurface",
      surfaceId: patch.surfaceId ?? visibleSurfaceId,
      changes: patch.changes,
    },
    patch.invocationKey,
  );
  signal?.throwIfAborted();
  return receipt;
}
