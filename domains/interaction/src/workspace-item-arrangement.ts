import type { SceneChange, WorkspaceItem } from "@foldthink/surface";

export type WorkspaceItemDrop = Readonly<{
  itemId: string;
  x: number;
  y: number;
}>;

function overlapRatio(
  moving: Readonly<{ x: number; y: number; width: number; height: number }>,
  target: WorkspaceItem,
): number {
  const width = Math.max(
    0,
    Math.min(moving.x + moving.width, target.x + target.width) - Math.max(moving.x, target.x),
  );
  const height = Math.max(
    0,
    Math.min(moving.y + moving.height, target.y + target.height) - Math.max(moving.y, target.y),
  );
  return width * height / Math.min(moving.width * moving.height, target.width * target.height);
}

export function arrangeWorkspaceItemDrop(
  items: readonly WorkspaceItem[],
  drop: WorkspaceItemDrop,
  createStackId: () => string,
): readonly SceneChange[] {
  const moving = items.find((item) => item.id === drop.itemId);
  if (!moving) throw new RangeError(`Unknown workspace item: ${drop.itemId}`);
  const target = items
    .filter((item) => item.id !== moving.id)
    .map((item) => ({
      item,
      overlap: overlapRatio({ ...drop, width: moving.width, height: moving.height }, item),
    }))
    .filter(({ overlap }) => overlap >= 0.48)
    .sort((left, right) => right.overlap - left.overlap || right.item.z - left.item.z)[0]?.item;
  const highestZ = items.reduce((maximum, item) => Math.max(maximum, item.z), 0);
  if (!target) {
    const unstacked = { ...moving };
    delete unstacked.stackId;
    return Object.freeze([Object.freeze({
      action: "put",
      expectedVersion: moving.version,
      element: Object.freeze({
        ...unstacked,
        x: drop.x,
        y: drop.y,
        z: highestZ + 1,
        stackOrder: 0,
      }),
    })]);
  }

  const stackId = target.stackId ?? createStackId();
  const members = items.filter((item) =>
    item.id !== moving.id && (item.id === target.id || item.stackId === stackId));
  const base = [...members]
    .sort((left, right) => left.stackOrder - right.stackOrder || left.z - right.z)[0] ?? target;
  const nextOrder = members.reduce((maximum, item) => Math.max(maximum, item.stackOrder), -1) + 1;
  const movingChange: SceneChange = Object.freeze({
    action: "put",
    expectedVersion: moving.version,
    element: Object.freeze({
      ...moving,
      x: base.x + nextOrder * 18,
      y: base.y + nextOrder * 18,
      z: highestZ + 1,
      stackId,
      stackOrder: nextOrder,
    }),
  });
  if (target.stackId) return Object.freeze([movingChange]);

  return Object.freeze([
    Object.freeze({
      action: "put",
      expectedVersion: target.version,
      element: Object.freeze({ ...target, stackId, stackOrder: 0 }),
    }),
    movingChange,
  ]);
}
