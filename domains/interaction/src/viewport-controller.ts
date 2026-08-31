export type ScreenPoint = Readonly<{ x: number; y: number }>;
export type ViewportState = Readonly<{ x: number; y: number; scale: number }>;

export class ViewportController {
  #state: ViewportState = Object.freeze({ x: 0, y: 0, scale: 1 });
  readonly #listeners = new Set<(state: ViewportState) => void>();

  state(): ViewportState {
    return this.#state;
  }

  screenToWorld(point: ScreenPoint): ScreenPoint {
    return Object.freeze({
      x: (point.x - this.#state.x) / this.#state.scale,
      y: (point.y - this.#state.y) / this.#state.scale,
    });
  }

  panBy(deltaX: number, deltaY: number): void {
    this.#set({ ...this.#state, x: this.#state.x + deltaX, y: this.#state.y + deltaY });
  }

  zoomAround(screenPoint: ScreenPoint, scaleFactor: number): void {
    if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      return;
    }
    const worldPoint = this.screenToWorld(screenPoint);
    const nextScale = Math.min(8, Math.max(0.15, this.#state.scale * scaleFactor));
    this.#set({
      scale: nextScale,
      x: screenPoint.x - worldPoint.x * nextScale,
      y: screenPoint.y - worldPoint.y * nextScale,
    });
  }

  observe(listener: (state: ViewportState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(state: ViewportState): void {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
