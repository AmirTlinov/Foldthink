import type { EraserStyle, InkStroke, ScenePoint } from "@foldthink/surface";
import { segmentDistanceSquared } from "./ink-geometry.js";

const cellSize = 160;
const maximumIndexedCellsPerStroke = 4_096;

type Bounds = Readonly<{ minimumX: number; minimumY: number; maximumX: number; maximumY: number }>;

function bounds(points: readonly ScenePoint[], padding: number): Bounds {
  const first = points[0];
  if (!first) throw new TypeError("Ink geometry needs at least one point.");
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
    minimumX: minimumX - padding,
    minimumY: minimumY - padding,
    maximumX: maximumX + padding,
    maximumY: maximumY + padding,
  });
}
function cellRange(area: Bounds): Readonly<{ x0: number; y0: number; x1: number; y1: number; count: number }> {
  const x0 = Math.floor(area.minimumX / cellSize);
  const y0 = Math.floor(area.minimumY / cellSize);
  const x1 = Math.floor(area.maximumX / cellSize);
  const y1 = Math.floor(area.maximumY / cellSize);
  return Object.freeze({ x0, y0, x1, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) });
}

function segments(points: readonly ScenePoint[]): readonly Readonly<[ScenePoint, ScenePoint]>[] {
  if (points.length === 1) {
    const point = points[0];
    return point
      ? Object.freeze([Object.freeze([point, point]) as Readonly<[ScenePoint, ScenePoint]>])
      : Object.freeze([]);
  }
  return Object.freeze(points.slice(1).flatMap((point, index) => {
    const previous = points[index];
    return previous ? [Object.freeze([previous, point]) as Readonly<[ScenePoint, ScenePoint]>] : [];
  }));
}

export type EraseGeometry = Readonly<{
  points: readonly ScenePoint[];
  style: EraserStyle;
}>;

function intersects(stroke: InkStroke, mask: EraseGeometry): boolean {
  const threshold = stroke.style.width / 2 + mask.style.maximumWidth / 2;
  const thresholdSquared = threshold * threshold;
  const strokeSegments = segments(stroke.points);
  const maskSegments = segments(mask.points);
  return strokeSegments.some(([strokeStart, strokeEnd]) =>
    maskSegments.some(([maskStart, maskEnd]) =>
      segmentDistanceSquared(strokeStart, strokeEnd, maskStart, maskEnd) <= thresholdSquared));
}

export class InkSpatialIndex {
  readonly #strokes = new Map<string, InkStroke>();
  readonly #cells = new Map<string, Set<string>>();
  readonly #overflow = new Set<string>();

  constructor(strokes: readonly InkStroke[]) {
    for (const stroke of strokes) {
      this.#strokes.set(stroke.id, stroke);
      const range = cellRange(bounds(stroke.points, stroke.style.width / 2));
      if (range.count > maximumIndexedCellsPerStroke) {
        this.#overflow.add(stroke.id);
        continue;
      }
      for (let y = range.y0; y <= range.y1; y += 1) {
        for (let x = range.x0; x <= range.x1; x += 1) {
          const key = `${x}:${y}`;
          const ids = this.#cells.get(key) ?? new Set<string>();
          ids.add(stroke.id);
          this.#cells.set(key, ids);
        }
      }
    }
  }

  affectedStrokeIds(mask: EraseGeometry): readonly string[] {
    return this.#affectedStrokeIds(mask);
  }

  affectedStrokeIdsForSegment(
    start: ScenePoint,
    end: ScenePoint,
    style: EraserStyle,
  ): readonly string[] {
    return this.#affectedStrokeIds(Object.freeze({
      points: Object.freeze([start, end]),
      style,
    }));
  }

  #affectedStrokeIds(mask: EraseGeometry): readonly string[] {
    const range = cellRange(bounds(mask.points, mask.style.maximumWidth / 2));
    const candidateIds = new Set(this.#overflow);
    if (range.count > maximumIndexedCellsPerStroke) {
      for (const strokeId of this.#strokes.keys()) candidateIds.add(strokeId);
    } else {
      for (let y = range.y0; y <= range.y1; y += 1) {
        for (let x = range.x0; x <= range.x1; x += 1) {
          for (const strokeId of this.#cells.get(`${x}:${y}`) ?? []) candidateIds.add(strokeId);
        }
      }
    }
    return Object.freeze([...candidateIds]
      .filter((strokeId) => {
        const stroke = this.#strokes.get(strokeId);
        return stroke ? intersects(stroke, mask) : false;
      })
      .sort());
  }
}
