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
  const first = points[0];
  if (!first) return Object.freeze({ x: 0, y: 0, width: 0, height: 0 });
  let minimumX = first.x;
  let minimumY = first.y;
  let maximumX = first.x;
  let maximumY = first.y;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  return Object.freeze({
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
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
      minimumOpacity: element.style.minimumOpacity,
      maximumOpacity: element.style.maximumOpacity,
      pressureRange: Object.freeze({
        minimum: element.points.reduce((minimum, point) => Math.min(minimum, point.pressure), 1),
        maximum: element.points.reduce((maximum, point) => Math.max(maximum, point.pressure), 0),
      }),
    });
  }
  if (element.kind === "erase") {
    const visibleStrokeIds = element.affectedStrokeIds.slice(0, 64);
    return Object.freeze({
      id: element.id,
      kind: element.kind,
      version: element.version,
      pointCount: element.points.length,
      bounds: bounds(element.points),
      minimumWidth: element.style.minimumWidth,
      maximumWidth: element.style.maximumWidth,
      affectedStrokeCount: element.affectedStrokeIds.length,
      affectedStrokeIds: Object.freeze(visibleStrokeIds),
      affectedStrokeIdsTruncated: visibleStrokeIds.length < element.affectedStrokeIds.length,
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
