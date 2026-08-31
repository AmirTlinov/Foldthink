import type { EraserStyle, InkStyle } from "@foldthink/surface";

export type DrawingToolState = Readonly<{
  selected: "pen" | "eraser";
  pen: InkStyle;
  eraser: EraserStyle;
}>;

const initialState: DrawingToolState = Object.freeze({
  selected: "pen",
  pen: Object.freeze({
    color: "#171714",
    width: 4.2,
    minimumOpacity: 0.18,
    maximumOpacity: 0.98,
  }),
  eraser: Object.freeze({
    minimumWidth: 18,
    maximumWidth: 72,
  }),
});

function finiteRange(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}
function normalizedState(state: DrawingToolState): DrawingToolState {
  if (state.selected !== "pen" && state.selected !== "eraser") {
    throw new TypeError("The selected drawing tool is unknown.");
  }
  if (!/^#[0-9a-f]{6}$/iu.test(state.pen.color)) {
    throw new TypeError("Pen color must be a six-digit hex color.");
  }
  finiteRange(state.pen.width, 0.5, 40, "Pen width");
  finiteRange(state.pen.maximumOpacity, 0.02, 1, "Maximum opacity");
  finiteRange(state.pen.minimumOpacity, 0.02, state.pen.maximumOpacity, "Minimum opacity");
  finiteRange(state.eraser.minimumWidth, 1, 400, "Minimum eraser width");
  finiteRange(state.eraser.maximumWidth, state.eraser.minimumWidth, 400, "Maximum eraser width");
  return Object.freeze({
    selected: state.selected,
    pen: Object.freeze({ ...state.pen, color: state.pen.color.toLowerCase() }),
    eraser: Object.freeze({ ...state.eraser }),
  });
}

export class DrawingToolController {
  #state: DrawingToolState;
  readonly #listeners = new Set<(state: DrawingToolState) => void>();

  constructor(state: DrawingToolState = initialState) {
    this.#state = normalizedState(state);
  }

  state(): DrawingToolState {
    return this.#state;
  }

  select(selected: "pen" | "eraser"): void {
    this.#set({ ...this.#state, selected });
  }

  setPenColor(color: string): void {
    if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new TypeError("Pen color must be a six-digit hex color.");
    this.#set({ ...this.#state, pen: { ...this.#state.pen, color } });
  }

  setPenWidth(width: number): void {
    this.#set({
      ...this.#state,
      pen: { ...this.#state.pen, width: finiteRange(width, 0.5, 40, "Pen width") },
    });
  }

  setMinimumOpacity(minimumOpacity: number): void {
    this.#set({
      ...this.#state,
      pen: {
        ...this.#state.pen,
        minimumOpacity: finiteRange(minimumOpacity, 0.02, this.#state.pen.maximumOpacity, "Minimum opacity"),
      },
    });
  }

  setEraserMaximumWidth(maximumWidth: number): void {
    const maximum = finiteRange(maximumWidth, 12, 240, "Eraser width");
    this.#set({
      ...this.#state,
      eraser: { minimumWidth: Math.max(6, maximum * 0.25), maximumWidth: maximum },
    });
  }

  observe(listener: (state: DrawingToolState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(state: DrawingToolState): void {
    this.#state = normalizedState(state);
    for (const listener of this.#listeners) listener(this.#state);
  }
}
