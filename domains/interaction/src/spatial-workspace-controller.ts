export type SpatialViewState =
  | Readonly<{ mode: "board"; selectedItemId?: string }>
  | Readonly<{ mode: "entering"; itemId: string; progress: number; direction: "in" | "out" }>
  | Readonly<{ mode: "item"; itemId: string }>;

export type ItemMovePreview = Readonly<{
  itemId: string;
  x: number;
  y: number;
}>;

function unit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class SpatialWorkspaceController {
  #state: SpatialViewState = Object.freeze({ mode: "board" });
  #move: ItemMovePreview | undefined;
  readonly #listeners = new Set<(state: SpatialViewState) => void>();

  state(): SpatialViewState {
    return this.#state;
  }

  selectedItemId(): string | undefined {
    if (this.#state.mode === "board") return this.#state.selectedItemId;
    return this.#state.itemId;
  }

  select(itemId?: string): void {
    if (this.#state.mode !== "board") return;
    this.#move = undefined;
    this.#set(Object.freeze({ mode: "board", ...(itemId ? { selectedItemId: itemId } : {}) }));
  }

  open(itemId: string): void {
    this.#move = undefined;
    this.#set(Object.freeze({ mode: "item", itemId }));
  }

  previewTransition(itemId: string, progress: number, direction: "in" | "out"): void {
    this.#move = undefined;
    this.#set(Object.freeze({ mode: "entering", itemId, progress: unit(progress), direction }));
  }

  settleTransition(): void {
    if (this.#state.mode !== "entering") return;
    const { itemId, progress } = this.#state;
    this.#set(progress >= 0.68
      ? Object.freeze({ mode: "item", itemId })
      : Object.freeze({ mode: "board", selectedItemId: itemId }));
  }

  close(): void {
    if (this.#state.mode === "board") return;
    this.#set(Object.freeze({ mode: "board", selectedItemId: this.#state.itemId }));
  }

  beginMove(itemId: string, x: number, y: number): void {
    if (this.#state.mode !== "board" || this.#state.selectedItemId !== itemId) return;
    this.#move = Object.freeze({ itemId, x, y });
    this.#emit();
  }

  moveTo(x: number, y: number): void {
    if (!this.#move) return;
    this.#move = Object.freeze({ ...this.#move, x, y });
    this.#emit();
  }

  finishMove(): ItemMovePreview | undefined {
    const move = this.#move;
    this.#move = undefined;
    this.#emit();
    return move;
  }

  cancelMove(): void {
    if (!this.#move) return;
    this.#move = undefined;
    this.#emit();
  }

  movePreview(): ItemMovePreview | undefined {
    return this.#move;
  }

  observe(listener: (state: SpatialViewState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #set(state: SpatialViewState): void {
    this.#state = state;
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#state);
  }
}
