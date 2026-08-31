import type { SceneElement, SurfaceSnapshot } from "@foldthink/surface";

function opaqueRevision(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function bounds(points: readonly Readonly<{ x: number; y: number }>[]): Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minimumX = Math.min(...xs);
  const minimumY = Math.min(...ys);
  return Object.freeze({
    x: minimumX,
    y: minimumY,
    width: Math.max(...xs) - minimumX,
    height: Math.max(...ys) - minimumY,
  });
}

function inspectElement(element: SceneElement): Readonly<Record<string, unknown>> {
  if (element.kind === "ink") {
    return Object.freeze({
      id: element.id,
      kind: element.kind,
      version: element.version,
      pointCount: element.points.length,
      bounds: bounds(element.points),
      color: element.style.color,
      width: element.style.width,
    });
  }
  if (element.kind === "markdown") {
    return Object.freeze({
      ...element,
      source: element.source.slice(0, 500),
      truncated: element.source.length > 500,
    });
  }
  return Object.freeze({ ...element });
}

export function inspectCurrentSurface(
  workspaceId: string,
  snapshot: SurfaceSnapshot,
  committedRevision?: number,
): Readonly<Record<string, unknown>> {
  const visibleElements = snapshot.elements.slice(0, 32).map(inspectElement);
  return Object.freeze({
    workspaceId,
    surfaceId: snapshot.surfaceId,
    revision: Object.freeze({
      local: opaqueRevision(snapshot.stateVector),
      ...(committedRevision === undefined ? {} : { committed: committedRevision }),
    }),
    elementCount: snapshot.elements.length,
    elements: Object.freeze(visibleElements),
    truncated: snapshot.elements.length > visibleElements.length,
  });
}
