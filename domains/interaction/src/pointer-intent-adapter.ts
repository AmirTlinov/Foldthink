import type { InkStyle, WorkspaceItem } from "@foldthink/surface";
import type { WorkspaceRuntime } from "@foldthink/workspace";
import type { CanvasSceneRenderer } from "./canvas-scene-renderer.js";
import { GestureArena } from "./gesture-arena.js";
import { InkSession, type InkSample } from "./ink-session.js";
import type { SpatialWorkspaceController } from "./spatial-workspace-controller.js";
import type { ScreenPoint, ViewportController } from "./viewport-controller.js";
import { arrangeWorkspaceItemDrop } from "./workspace-item-arrangement.js";

export type PointerAdapterOptions = Readonly<{
  canvas: HTMLCanvasElement;
  boardSurfaceId: string;
  runtime: WorkspaceRuntime;
  renderer: CanvasSceneRenderer;
  viewport: ViewportController;
  spatial: SpatialWorkspaceController;
  penStyle?: InkStyle;
  onPageTurn?: (direction: -1 | 1) => void;
  onCommitError?: (error: unknown) => void;
}>;

const defaultPenStyle: InkStyle = Object.freeze({
  color: "#171714",
  width: 2.4,
  minimumOpacity: 0.22,
  maximumOpacity: 0.96,
});

type TrackedContact = {
  start: ScreenPoint;
  current: ScreenPoint;
  itemId?: string;
  moved: boolean;
};

export class PointerIntentAdapter {
  readonly #options: PointerAdapterOptions;
  readonly #arena = new GestureArena();
  readonly #contacts = new Map<number, TrackedContact>();
  #ink: InkSession | undefined;
  #inkPointerId: number | undefined;
  #inkSurfaceId: string | undefined;
  #movePointerId: number | undefined;
  #moveOffset: ScreenPoint | undefined;
  #holdTimer: ReturnType<typeof setTimeout> | undefined;
  #lastTap: Readonly<{ itemId: string; time: number }> | undefined;
  #itemPinchScale = 1;

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
    this.#clearHold();
    this.#cancelInk();
    this.#options.spatial.cancelMove();
    this.#arena.cancel();
  }

  readonly #pointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    this.#options.canvas.setPointerCapture(event.pointerId);
    const screen = this.#screenPoint(event);
    const spatial = this.#options.spatial.state();
    const item = spatial.mode === "board" ? this.#options.renderer.itemAtScreen(screen) : undefined;
    const draws = event.pointerType === "pen" || (
      event.pointerType === "mouse" && (
        spatial.mode === "item" || (!item && this.#options.spatial.selectedItemId() === undefined)
      )
    );
    if (draws) {
      const target = this.#options.renderer.resolveSurfaceTarget(screen);
      this.#inkPointerId = event.pointerId;
      this.#inkSurfaceId = target.surfaceId;
      this.#ink = new InkSession(
        crypto.randomUUID(),
        this.#options.penStyle ?? defaultPenStyle,
        this.#sample(event, target.surfaceId),
      );
      this.#options.renderer.setActiveInk(this.#ink, target.surfaceId);
      return;
    }

    const contact: TrackedContact = {
      start: screen,
      current: screen,
      ...(item ? { itemId: item.id } : {}),
      moved: false,
    };
    this.#contacts.set(event.pointerId, contact);
    this.#arena.begin(event.pointerId, screen);
    if (this.#contacts.size >= 2) {
      this.#clearHold();
      this.#itemPinchScale = 1;
      return;
    }
    if (item && spatial.mode === "board") {
      this.#options.spatial.select(item.id);
      this.#scheduleMove(event.pointerId, item, screen);
    }
  };

  readonly #pointerMove = (event: PointerEvent): void => {
    event.preventDefault();
    if (event.pointerId === this.#inkPointerId && this.#ink && this.#inkSurfaceId) {
      const coalesced = event.getCoalescedEvents?.() ?? [event];
      this.#ink.append(coalesced.map((sample) => this.#sample(sample, this.#inkSurfaceId as string)));
      this.#options.renderer.setActiveInk(this.#ink, this.#inkSurfaceId);
      return;
    }

    const contact = this.#contacts.get(event.pointerId);
    if (!contact) return;
    const screen = this.#screenPoint(event);
    contact.current = screen;
    if (Math.hypot(screen.x - contact.start.x, screen.y - contact.start.y) >= 5) {
      contact.moved = true;
      this.#clearHold();
    }
    if (event.pointerId === this.#movePointerId && this.#moveOffset) {
      const world = this.#options.viewport.screenToWorld(screen);
      this.#options.spatial.moveTo(world.x - this.#moveOffset.x, world.y - this.#moveOffset.y);
      return;
    }

    const update = this.#arena.move(event.pointerId, screen);
    if (update.owner === "pan") {
      if (this.#options.spatial.state().mode === "board") {
        this.#options.viewport.panBy(update.deltaX, update.deltaY);
      }
    } else if (update.owner === "pinch") {
      this.#clearHold();
      this.#handlePinch(update.center, update.scaleFactor);
    }
  };

  readonly #pointerEnd = (event: PointerEvent): void => {
    event.preventDefault();
    if (event.pointerId === this.#inkPointerId && this.#ink && this.#inkSurfaceId) {
      const completedInk = this.#ink;
      const surfaceId = this.#inkSurfaceId;
      this.#ink = undefined;
      this.#inkPointerId = undefined;
      this.#inkSurfaceId = undefined;
      void this.#options.runtime.dispatch({
        kind: "commitStroke",
        surfaceId,
        stroke: completedInk.stroke(),
      }).then(() => this.#options.renderer.setActiveInk(undefined)).catch((error: unknown) => {
        this.#options.renderer.setActiveInk(undefined);
        this.#options.onCommitError?.(error);
      });
      return;
    }

    this.#clearHold();
    const contact = this.#contacts.get(event.pointerId);
    const wasPinch = this.#contacts.size >= 2 || this.#options.spatial.state().mode === "entering";
    this.#contacts.delete(event.pointerId);
    this.#arena.end(event.pointerId);
    if (event.pointerId === this.#movePointerId) {
      this.#commitMove();
    } else if (contact && !contact.moved && !wasPinch) {
      this.#tap(contact, event.timeStamp);
    } else if (contact && this.#options.spatial.state().mode === "item" && !wasPinch) {
      const deltaX = contact.current.x - contact.start.x;
      const deltaY = contact.current.y - contact.start.y;
      if (Math.abs(deltaX) >= 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35) {
        this.#options.onPageTurn?.(deltaX < 0 ? 1 : -1);
      }
    }
    if (this.#contacts.size === 0) {
      this.#options.spatial.settleTransition();
      this.#itemPinchScale = 1;
    }
  };

  readonly #pointerCancel = (event: PointerEvent): void => {
    this.#clearHold();
    if (event.pointerId === this.#inkPointerId) this.#cancelInk();
    if (event.pointerId === this.#movePointerId) {
      this.#options.spatial.cancelMove();
      this.#movePointerId = undefined;
      this.#moveOffset = undefined;
    }
    this.#contacts.delete(event.pointerId);
    this.#arena.end(event.pointerId);
    if (this.#contacts.size === 0) this.#options.spatial.settleTransition();
  };

  readonly #lostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.#inkPointerId || this.#contacts.has(event.pointerId)) {
      this.#pointerCancel(event);
    }
  };

  readonly #contextMenu = (event: MouseEvent): void => event.preventDefault();

  #tap(contact: TrackedContact, time: number): void {
    const state = this.#options.spatial.state();
    if (state.mode !== "board") return;
    if (!contact.itemId) {
      this.#options.spatial.select();
      this.#lastTap = undefined;
      return;
    }
    if (this.#lastTap?.itemId === contact.itemId && time - this.#lastTap.time <= 360) {
      this.#options.spatial.open(contact.itemId);
      this.#lastTap = undefined;
      return;
    }
    this.#options.spatial.select(contact.itemId);
    this.#lastTap = Object.freeze({ itemId: contact.itemId, time });
  }

  #scheduleMove(pointerId: number, item: WorkspaceItem, screen: ScreenPoint): void {
    this.#clearHold();
    this.#holdTimer = setTimeout(() => {
      const contact = this.#contacts.get(pointerId);
      if (!contact || contact.moved || this.#contacts.size !== 1) return;
      const world = this.#options.viewport.screenToWorld(screen);
      this.#movePointerId = pointerId;
      this.#moveOffset = Object.freeze({ x: world.x - item.x, y: world.y - item.y });
      this.#options.spatial.beginMove(item.id, item.x, item.y);
    }, 320);
  }

  #commitMove(): void {
    const preview = this.#options.spatial.movePreview();
    const item = preview ? this.#options.renderer.item(preview.itemId) : undefined;
    this.#movePointerId = undefined;
    this.#moveOffset = undefined;
    if (!preview || !item) {
      this.#options.spatial.cancelMove();
      return;
    }
    const changes = arrangeWorkspaceItemDrop(
      this.#options.renderer.items(),
      preview,
      () => crypto.randomUUID(),
    );
    void this.#options.runtime.dispatch({
      kind: "patchSurface",
      surfaceId: this.#options.boardSurfaceId,
      changes,
    }).then(() => this.#options.spatial.cancelMove()).catch((error: unknown) => {
      this.#options.spatial.cancelMove();
      this.#options.onCommitError?.(error);
    });
  }

  #handlePinch(center: ScreenPoint, scaleFactor: number): void {
    const state = this.#options.spatial.state();
    if (state.mode === "item" || (state.mode === "entering" && state.direction === "out")) {
      const itemId = state.itemId;
      this.#options.viewport.zoomAround(center, scaleFactor);
      this.#itemPinchScale *= scaleFactor;
      const progress = Math.max(0, Math.min(1, (this.#itemPinchScale - 0.5) / 0.5));
      this.#options.spatial.previewTransition(itemId, progress, "out");
      return;
    }
    if (state.mode === "entering" && state.direction === "in") {
      const logarithmicDelta = Math.log(scaleFactor) / Math.log(1.65);
      this.#options.spatial.previewTransition(
        state.itemId,
        state.progress + logarithmicDelta,
        "in",
      );
      return;
    }
    this.#options.viewport.zoomAround(center, scaleFactor);
    const item = this.#options.renderer.itemAtScreen(center);
    if (!item || scaleFactor <= 1) return;
    const viewport = this.#options.viewport.state();
    const bounds = this.#options.canvas.getBoundingClientRect();
    const coverage = Math.min(
      item.width * viewport.scale / Math.max(1, bounds.width),
      item.height * viewport.scale / Math.max(1, bounds.height),
    );
    let progress = Math.max(0, Math.min(0.18, (coverage - 0.58) / 0.32));
    if (scaleFactor >= 1.14 && coverage >= 0.48) progress = Math.max(progress, 0.72);
    if (progress > 0) this.#options.spatial.previewTransition(item.id, progress, "in");
  }

  #clearHold(): void {
    if (this.#holdTimer) clearTimeout(this.#holdTimer);
    this.#holdTimer = undefined;
  }

  #cancelInk(): void {
    this.#ink = undefined;
    this.#inkPointerId = undefined;
    this.#inkSurfaceId = undefined;
    this.#options.renderer.setActiveInk(undefined);
  }

  #screenPoint(event: PointerEvent): ScreenPoint {
    const bounds = this.#options.canvas.getBoundingClientRect();
    return Object.freeze({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }

  #sample(event: PointerEvent, surfaceId: string): InkSample {
    const point = this.#options.renderer.mapScreenToSurface(this.#screenPoint(event), surfaceId);
    return Object.freeze({
      x: point.x,
      y: point.y,
      pressure: event.pressure || 0.5,
      time: event.timeStamp,
    });
  }
}
