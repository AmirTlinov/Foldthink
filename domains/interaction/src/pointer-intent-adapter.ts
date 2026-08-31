import type { InkStyle } from "@foldthink/surface";
import type { WorkspaceRuntime } from "@foldthink/workspace";
import type { CanvasSceneRenderer } from "./canvas-scene-renderer.js";
import { GestureArena } from "./gesture-arena.js";
import { InkSession, type InkSample } from "./ink-session.js";
import type { ViewportController } from "./viewport-controller.js";

export type PointerAdapterOptions = Readonly<{
  canvas: HTMLCanvasElement;
  surfaceId: string;
  runtime: WorkspaceRuntime;
  renderer: CanvasSceneRenderer;
  viewport: ViewportController;
  penStyle?: InkStyle;
  onCommitError?: (error: unknown) => void;
}>;

const defaultPenStyle: InkStyle = Object.freeze({
  color: "#171714",
  width: 2.4,
  minimumOpacity: 0.22,
  maximumOpacity: 0.96,
});

export class PointerIntentAdapter {
  readonly #options: PointerAdapterOptions;
  readonly #arena = new GestureArena();
  #ink: InkSession | undefined;
  #inkPointerId: number | undefined;

  constructor(options: PointerAdapterOptions) {
    this.#options = options;
    const canvas = options.canvas;
    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";
    canvas.addEventListener("pointerdown", this.#pointerDown);
    canvas.addEventListener("pointermove", this.#pointerMove);
    canvas.addEventListener("pointerup", this.#pointerEnd);
    canvas.addEventListener("pointercancel", this.#pointerCancel);
    canvas.addEventListener("lostpointercapture", this.#lostPointerCapture);
    canvas.addEventListener("contextmenu", this.#contextMenu);
  }

  destroy(): void {
    const canvas = this.#options.canvas;
    canvas.removeEventListener("pointerdown", this.#pointerDown);
    canvas.removeEventListener("pointermove", this.#pointerMove);
    canvas.removeEventListener("pointerup", this.#pointerEnd);
    canvas.removeEventListener("pointercancel", this.#pointerCancel);
    canvas.removeEventListener("lostpointercapture", this.#lostPointerCapture);
    canvas.removeEventListener("contextmenu", this.#contextMenu);
    this.#cancelInk();
    this.#arena.cancel();
  }

  readonly #pointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.#options.canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === "pen" || event.pointerType === "mouse") {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const sample = this.#sample(event);
      this.#inkPointerId = event.pointerId;
      this.#ink = new InkSession(
        crypto.randomUUID(),
        this.#options.penStyle ?? defaultPenStyle,
        sample,
      );
      this.#options.renderer.setActiveInk(this.#ink);
      return;
    }
    this.#arena.begin(event.pointerId, this.#screenPoint(event));
  };

  readonly #pointerMove = (event: PointerEvent): void => {
    event.preventDefault();
    if (event.pointerId === this.#inkPointerId && this.#ink) {
      const coalesced = event.getCoalescedEvents?.() ?? [event];
      this.#ink.append(coalesced.map((sample) => this.#sample(sample)));
      this.#options.renderer.setActiveInk(this.#ink);
      return;
    }
    if (event.pointerType !== "touch") return;
    const update = this.#arena.move(event.pointerId, this.#screenPoint(event));
    if (update.owner === "pan") {
      this.#options.viewport.panBy(update.deltaX, update.deltaY);
    } else if (update.owner === "pinch") {
      this.#options.viewport.zoomAround(update.center, update.scaleFactor);
    }
  };

  readonly #pointerEnd = (event: PointerEvent): void => {
    event.preventDefault();
    if (event.pointerId === this.#inkPointerId && this.#ink) {
      const completedInk = this.#ink;
      this.#ink = undefined;
      this.#inkPointerId = undefined;
      void this.#options.runtime
        .dispatch({
          kind: "commitStroke",
          surfaceId: this.#options.surfaceId,
          stroke: completedInk.stroke(),
        })
        .then(() => this.#options.renderer.setActiveInk(undefined))
        .catch((error: unknown) => {
          this.#options.renderer.setActiveInk(undefined);
          this.#options.onCommitError?.(error);
        });
      return;
    }
    this.#arena.end(event.pointerId);
  };

  readonly #pointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.#inkPointerId) {
      this.#cancelInk();
    }
    this.#arena.end(event.pointerId);
  };

  readonly #lostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.#inkPointerId) {
      this.#cancelInk();
    }
    this.#arena.end(event.pointerId);
  };

  readonly #contextMenu = (event: MouseEvent): void => event.preventDefault();

  #cancelInk(): void {
    this.#ink = undefined;
    this.#inkPointerId = undefined;
    this.#options.renderer.setActiveInk(undefined);
  }

  #screenPoint(event: PointerEvent): Readonly<{ x: number; y: number }> {
    const bounds = this.#options.canvas.getBoundingClientRect();
    return Object.freeze({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }

  #sample(event: PointerEvent): InkSample {
    const world = this.#options.viewport.screenToWorld(this.#screenPoint(event));
    return Object.freeze({
      x: world.x,
      y: world.y,
      pressure: event.pressure || 0.5,
      time: event.timeStamp,
    });
  }
}
