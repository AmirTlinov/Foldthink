import type { ScreenPoint } from "./viewport-controller.js";

export type GestureUpdate =
  | Readonly<{ owner: "undecided" }>
  | Readonly<{ owner: "pan"; deltaX: number; deltaY: number }>
  | Readonly<{ owner: "pinch"; center: ScreenPoint; scaleFactor: number }>;

type TrackedPointer = { current: ScreenPoint; previous: ScreenPoint; start: ScreenPoint };

function distance(left: ScreenPoint, right: ScreenPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export class GestureArena {
  readonly #pointers = new Map<number, TrackedPointer>();
  #owner: "undecided" | "pan" | "pinch" = "undecided";

  begin(pointerId: number, point: ScreenPoint): void {
    this.#pointers.set(pointerId, { current: point, previous: point, start: point });
    if (this.#pointers.size === 2 && this.#owner === "undecided") {
      this.#owner = "pinch";
    }
  }

  move(pointerId: number, point: ScreenPoint): GestureUpdate {
    const tracked = this.#pointers.get(pointerId);
    if (!tracked) {
      return { owner: "undecided" };
    }
    tracked.previous = tracked.current;
    tracked.current = point;

    const pointers = [...this.#pointers.values()];
    if (pointers.length >= 2) {
      this.#owner = "pinch";
      const first = pointers[0];
      const second = pointers[1];
      if (!first || !second) {
        return { owner: "undecided" };
      }
      const previousDistance = distance(first.previous, second.previous);
      const currentDistance = distance(first.current, second.current);
      return {
        owner: "pinch",
        center: {
          x: (first.current.x + second.current.x) / 2,
          y: (first.current.y + second.current.y) / 2,
        },
        scaleFactor: previousDistance > 0 ? currentDistance / previousDistance : 1,
      };
    }

    if (this.#owner === "undecided" && distance(tracked.start, tracked.current) >= 3) {
      this.#owner = "pan";
    }
    return this.#owner === "pan"
      ? {
          owner: "pan",
          deltaX: tracked.current.x - tracked.previous.x,
          deltaY: tracked.current.y - tracked.previous.y,
        }
      : { owner: "undecided" };
  }

  end(pointerId: number): void {
    this.#pointers.delete(pointerId);
    if (this.#pointers.size === 0) {
      this.#owner = "undecided";
    }
  }

  cancel(): void {
    this.#pointers.clear();
    this.#owner = "undecided";
  }
}
