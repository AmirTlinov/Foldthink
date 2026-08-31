import type { EraseMask, EraserStyle, ScenePoint } from "@foldthink/surface";
import type { InkSample } from "./ink-session.js";
import { InkSpatialIndex } from "./ink-spatial-index.js";

function normalizedSample(sample: InkSample): ScenePoint {
  return Object.freeze({
    x: sample.x,
    y: sample.y,
    pressure: Number.isFinite(sample.pressure)
      ? Math.min(1, Math.max(0, sample.pressure))
      : 0.5,
    time: sample.time,
  });
}
export class EraseSession {
  readonly #maskId: string;
  readonly #style: EraserStyle;
  readonly #points: ScenePoint[] = [];
  readonly #affectedStrokeIds = new Set<string>();
  #indexedPointCount = 0;
  #index: InkSpatialIndex | undefined;

  constructor(maskId: string, style: EraserStyle, firstSample: InkSample) {
    this.#maskId = maskId;
    this.#style = Object.freeze({ ...style });
    this.#points.push(normalizedSample(firstSample));
  }

  append(samples: readonly InkSample[]): void {
    for (const sample of samples) {
      const point = normalizedSample(sample);
      const previous = this.#points.at(-1);
      if (
        !previous ||
        (point.time >= previous.time &&
          (point.time !== previous.time || point.x !== previous.x || point.y !== previous.y))
      ) {
        this.#points.push(point);
      }
    }
  }

  preview(index: InkSpatialIndex): EraseMask {
    if (this.#index !== index) {
      this.#index = index;
      this.#indexedPointCount = 0;
      this.#affectedStrokeIds.clear();
    }
    while (this.#indexedPointCount < this.#points.length) {
      const end = this.#points[this.#indexedPointCount];
      const start = this.#points[Math.max(0, this.#indexedPointCount - 1)];
      if (start && end) {
        for (const strokeId of index.affectedStrokeIdsForSegment(start, end, this.#style)) {
          this.#affectedStrokeIds.add(strokeId);
        }
      }
      this.#indexedPointCount += 1;
    }
    const geometry = Object.freeze({
      points: Object.freeze([...this.#points]),
      style: this.#style,
    });
    return Object.freeze({
      id: this.#maskId,
      kind: "erase",
      version: 1,
      ...geometry,
      affectedStrokeIds: Object.freeze([...this.#affectedStrokeIds].sort()),
    });
  }
}
