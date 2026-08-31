import type { InkStroke, InkStyle, ScenePoint } from "@foldthink/surface";

export type InkSample = Readonly<{
  x: number;
  y: number;
  pressure: number;
  time: number;
}>;

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

export class InkSession {
  readonly #style: InkStyle;
  readonly #strokeId: string;
  readonly #points: ScenePoint[] = [];
  #predicted: readonly ScenePoint[] = Object.freeze([]);

  constructor(strokeId: string, style: InkStyle, firstSample: InkSample) {
    this.#strokeId = strokeId;
    this.#style = Object.freeze({ ...style });
    this.#points.push(normalizedSample(firstSample));
  }

  append(samples: readonly InkSample[]): void {
    this.#predicted = Object.freeze([]);
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

  predict(samples: readonly InkSample[]): void {
    const lastActual = this.#points.at(-1);
    this.#predicted = Object.freeze(samples
      .map(normalizedSample)
      .filter((point) => !lastActual || point.time >= lastActual.time));
  }

  stroke(): InkStroke {
    return Object.freeze({
      id: this.#strokeId,
      kind: "ink",
      version: 1,
      points: Object.freeze([...this.#points]),
      style: this.#style,
    });
  }

  displayStroke(): InkStroke {
    return Object.freeze({
      ...this.stroke(),
      points: Object.freeze([...this.#points, ...this.#predicted]),
    });
  }
}
