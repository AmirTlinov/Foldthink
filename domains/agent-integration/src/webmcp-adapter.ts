import type { CommandReceipt, WorkspaceRuntime } from "@foldthink/workspace";
import { applySurfacePatch } from "./apply-surface-patch-tool.js";
import { inspectCurrentSurface } from "./inspect-current-surface-tool.js";
import {
  inspectSurfaceInputSchema,
  patchSurfaceInputSchema,
  type SiteToolDefinition,
  type SiteToolExecutionContext,
  type WebMcpDocument,
} from "./site-tool-schema.js";

export type AgentPageContext = Readonly<{
  runtime: WorkspaceRuntime;
  visibleSurfaceId: string;
  authorizeEdit(signal?: AbortSignal): Promise<boolean>;
  committedRevision(surfaceId: string): number | undefined;
  waitForCommittedReceipt(
    operationId: string,
    timeoutMilliseconds: number,
    signal?: AbortSignal,
  ): Promise<CommandReceipt | undefined>;
}>;

export class WebMCPAdapter {
  readonly #document: WebMcpDocument;
  readonly #currentContext: () => AgentPageContext;
  readonly #registeredNames: string[] = [];

  constructor(
    currentContext: () => AgentPageContext,
    pageDocument: WebMcpDocument = document as WebMcpDocument,
  ) {
    this.#currentContext = currentContext;
    this.#document = pageDocument;
  }

  async register(): Promise<boolean> {
    const modelContext = this.#document.modelContext;
    if (typeof modelContext?.registerTool !== "function") {
      return false;
    }
    const definitions = this.#definitions();
    for (const definition of definitions) {
      await modelContext.registerTool(definition);
      this.#registeredNames.push(definition.name);
    }
    return true;
  }

  async destroy(): Promise<void> {
    const unregister = this.#document.modelContext?.unregisterTool;
    if (typeof unregister !== "function") return;
    for (const name of this.#registeredNames.splice(0)) {
      await unregister.call(this.#document.modelContext, name);
    }
  }

  #definitions(): readonly SiteToolDefinition[] {
    return Object.freeze([
      Object.freeze({
        name: "inspect_surface",
        description: "Inspect the semantic elements visible on the current Foldthink surface.",
        inputSchema: inspectSurfaceInputSchema,
        annotations: Object.freeze({ readOnlyHint: true, untrustedContentHint: true }),
        execute: async (
          input: unknown,
          context?: SiteToolExecutionContext,
        ): Promise<unknown> => {
          context?.signal?.throwIfAborted();
          const requestedSurface =
            input && typeof input === "object" && "surfaceId" in input
              ? (input as { surfaceId?: unknown }).surfaceId
              : undefined;
          if (requestedSurface !== undefined && typeof requestedSurface !== "string") {
            throw new TypeError("surfaceId must be a string.");
          }
          const current = this.#currentContext();
          const surfaceId = requestedSurface ?? current.visibleSurfaceId;
          return inspectCurrentSurface(
            current.runtime.workspaceId,
            current.runtime.inspect(surfaceId),
            current.committedRevision(surfaceId),
          );
        },
      }),
      Object.freeze({
        name: "patch_surface",
        description: "Add, edit, or delete typed elements on a Foldthink surface and return its receipt.",
        inputSchema: patchSurfaceInputSchema,
        annotations: Object.freeze({ idempotentHint: false, destructiveHint: false }),
        execute: async (
          input: unknown,
          context?: SiteToolExecutionContext,
        ): Promise<unknown> => {
          const current = this.#currentContext();
          if (!await current.authorizeEdit(context?.signal)) {
            throw new DOMException("This Foldthink session does not have edit access.", "NotAllowedError");
          }
          const receipt = await applySurfacePatch(
            current.runtime,
            current.visibleSurfaceId,
            input,
            context?.signal,
          );
          const committed = await current.waitForCommittedReceipt(
            receipt.operationId,
            8_000,
            context?.signal,
          );
          const result = committed ?? receipt;
          return Object.freeze({
            operationId: result.operationId,
            changedIds: result.changedIds,
            surfaces: result.surfaces,
            syncState: result.syncState,
          });
        },
      }),
    ]);
  }
}
