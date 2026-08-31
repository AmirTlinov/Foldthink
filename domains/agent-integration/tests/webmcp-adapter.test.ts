import assert from "node:assert/strict";
import test from "node:test";
import { SceneDocument } from "@foldthink/surface";
import {
  WorkspaceRuntime,
  type CommandReceipt,
  type LocalCommit,
  type WorkspaceCommitSink,
} from "@foldthink/workspace";
import {
  WebMCPAdapter,
  type SiteToolDefinition,
  type WebMcpDocument,
} from "../src/public-browser.js";

class MemorySink implements WorkspaceCommitSink {
  async commitLocal(commit: LocalCommit): Promise<CommandReceipt> {
    return { ...commit.receipt, syncState: "queued" };
  }
  async commitRemote(): Promise<void> {}
}

function runtime(): WorkspaceRuntime {
  return new WorkspaceRuntime("workspace", [new SceneDocument("board")], new MemorySink());
}

test("unsupported browsers keep the human runtime untouched", async () => {
  const workspace = runtime();
  const adapter = new WebMCPAdapter(
    () => ({
      runtime: workspace,
      visibleSurfaceId: "board",
      authorizeEdit: async () => true,
      committedRevision: () => undefined,
      waitForCommittedReceipt: async () => undefined,
    }),
    {} as WebMcpDocument,
  );
  assert.equal(await adapter.register(), false);
  assert.equal(workspace.inspect("board").elements.length, 0);
});

test("registered mutation and inspection use the same workspace runtime", async () => {
  const workspace = runtime();
  const tools = new Map<string, SiteToolDefinition>();
  const adapter = new WebMCPAdapter(
    () => ({
      runtime: workspace,
      visibleSurfaceId: "board",
      authorizeEdit: async () => true,
      committedRevision: () => undefined,
      waitForCommittedReceipt: async () => undefined,
    }),
    {
      modelContext: {
        registerTool(tool): void {
          tools.set(tool.name, tool);
        },
      },
    } as WebMcpDocument,
  );

  assert.equal(await adapter.register(), true);
  assert.deepEqual([...tools.keys()], ["inspect_surface", "patch_surface"]);
  const patch = tools.get("patch_surface");
  if (!patch) throw new Error("patch_surface was not registered.");
  const result = (await patch.execute({
    invocationKey: "test-patch",
    changes: [
      {
        action: "put",
        element: {
          id: "agent-note",
          kind: "markdown",
          version: 1,
          x: 40,
          y: 50,
          width: 300,
          source: "Think together",
          color: "#171714",
          fontSize: 28,
        },
      },
    ],
  })) as { changedIds: string[]; syncState: string };
  assert.deepEqual(result.changedIds, ["agent-note"]);
  assert.equal(result.syncState, "queued");

  const inspect = tools.get("inspect_surface");
  if (!inspect) throw new Error("inspect_surface was not registered.");
  const inspected = (await inspect.execute({})) as { elements: { id: string }[] };
  assert.equal(inspected.elements[0]?.id, "agent-note");
});

test("a committed mutation reports the server revision owned by synchronization", async () => {
  const workspace = runtime();
  const tools = new Map<string, SiteToolDefinition>();
  let operationId = "";
  const adapter = new WebMCPAdapter(
    () => ({
      runtime: workspace,
      visibleSurfaceId: "board",
      authorizeEdit: async () => true,
      committedRevision: () => 7,
      waitForCommittedReceipt: async (id) => {
        operationId = id;
        return {
          operationId: id,
          changedIds: ["agent-shape"],
          surfaces: [{ surfaceId: "board", revision: 7 }],
          syncState: "committed",
        };
      },
    }),
    {
      modelContext: {
        registerTool(tool): void {
          tools.set(tool.name, tool);
        },
      },
    } as WebMcpDocument,
  );
  await adapter.register();
  const patch = tools.get("patch_surface");
  if (!patch) throw new Error("patch_surface was not registered.");
  const result = await patch.execute({
    changes: [{
      action: "put",
      element: {
        id: "agent-shape",
        kind: "shape",
        version: 1,
        shape: "rectangle",
        x: 20,
        y: 20,
        width: 100,
        height: 70,
        stroke: "#171714",
        strokeWidth: 2,
      },
    }],
  }) as { operationId: string; syncState: string; surfaces: { revision?: number }[] };
  assert.equal(result.operationId, operationId);
  assert.equal(result.syncState, "committed");
  assert.equal(result.surfaces[0]?.revision, 7);

  const inspect = tools.get("inspect_surface");
  if (!inspect) throw new Error("inspect_surface was not registered.");
  const inspected = await inspect.execute({}) as { revision: { committed?: number } };
  assert.equal(inspected.revision.committed, 7);
});

test("a viewer can inspect but cannot dispatch an agent mutation", async () => {
  const workspace = runtime();
  const tools = new Map<string, SiteToolDefinition>();
  const adapter = new WebMCPAdapter(
    () => ({
      runtime: workspace,
      visibleSurfaceId: "board",
      authorizeEdit: async () => false,
      committedRevision: () => 1,
      waitForCommittedReceipt: async () => undefined,
    }),
    {
      modelContext: {
        registerTool(tool): void {
          tools.set(tool.name, tool);
        },
      },
    } as WebMcpDocument,
  );
  await adapter.register();
  const patch = tools.get("patch_surface");
  const inspect = tools.get("inspect_surface");
  if (!patch || !inspect) throw new Error("Foldthink agent tools were not registered.");
  await assert.rejects(
    patch.execute({ changes: [] }),
    { name: "NotAllowedError" },
  );
  assert.equal(workspace.inspect("board").elements.length, 0);
  assert.ok(await inspect.execute({}));
});

test("the generic patch tool cannot bypass atomic workspace-item creation", async () => {
  const workspace = runtime();
  const tools = new Map<string, SiteToolDefinition>();
  const adapter = new WebMCPAdapter(
    () => ({
      runtime: workspace,
      visibleSurfaceId: "board",
      authorizeEdit: async () => true,
      committedRevision: () => undefined,
      waitForCommittedReceipt: async () => undefined,
    }),
    {
      modelContext: {
        registerTool(tool): void {
          tools.set(tool.name, tool);
        },
      },
    } as WebMcpDocument,
  );
  await adapter.register();
  const patch = tools.get("patch_surface");
  if (!patch) throw new Error("patch_surface was not registered.");

  await assert.rejects(patch.execute({
    changes: [{
      action: "put",
      element: {
        id: "orphan-item",
        kind: "item",
        version: 1,
        itemKind: "notebook",
        x: 0,
        y: 0,
        width: 360,
        height: 504,
        z: 1,
        coverSurfaceId: "missing-cover",
        pageSurfaceIds: ["missing-page"],
        activePageIndex: 0,
        stackOrder: 0,
      },
    }],
  }), /dedicated semantic commands/u);
  assert.equal(workspace.inspect("board").elements.length, 0);
});
