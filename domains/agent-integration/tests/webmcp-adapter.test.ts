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
    () => ({ runtime: workspace, visibleSurfaceId: "board" }),
    {} as WebMcpDocument,
  );
  assert.equal(await adapter.register(), false);
  assert.equal(workspace.inspect("board").elements.length, 0);
});

test("registered mutation and inspection use the same workspace runtime", async () => {
  const workspace = runtime();
  const tools = new Map<string, SiteToolDefinition>();
  const adapter = new WebMCPAdapter(
    () => ({ runtime: workspace, visibleSurfaceId: "board" }),
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
