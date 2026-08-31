import type { WorkspaceItem } from "@foldthink/surface";
import type { ScreenPoint, ViewportController } from "./viewport-controller.js";

export const pageSize = Object.freeze({ width: 1_000, height: 1_400 });

export type SurfaceTransform = Readonly<{
  x: number;
  y: number;
  scale: number;
}>;

export function pageTransform(screenWidth: number, screenHeight: number): SurfaceTransform {
  const scale = Math.max(screenWidth / pageSize.width, screenHeight / pageSize.height);
  return Object.freeze({
    scale,
    x: (screenWidth - pageSize.width * scale) / 2,
    y: (screenHeight - pageSize.height * scale) / 2,
  });
}

export function screenToPage(
  point: ScreenPoint,
  screenWidth: number,
  screenHeight: number,
): ScreenPoint {
  const transform = pageTransform(screenWidth, screenHeight);
  return Object.freeze({
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  });
}

export function boardPointInItem(
  point: ScreenPoint,
  item: WorkspaceItem,
  viewport: ViewportController,
): ScreenPoint {
  const world = viewport.screenToWorld(point);
  return Object.freeze({ x: world.x - item.x, y: world.y - item.y });
}

export function itemAtWorld(
  items: readonly WorkspaceItem[],
  point: ScreenPoint,
): WorkspaceItem | undefined {
  return [...items]
    .sort((left, right) => right.z - left.z)
    .find((item) =>
      point.x >= item.x &&
      point.y >= item.y &&
      point.x <= item.x + item.width &&
      point.y <= item.y + item.height);
}
