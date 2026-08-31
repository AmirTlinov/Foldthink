import type {
  InkStroke,
  MarkdownBlock,
  SceneElement,
  ShapeElement,
  SurfaceSnapshot,
  WorkspaceItem,
} from "@foldthink/surface";
import type { InkSession } from "./ink-session.js";
import { itemAtWorld, pageTransform, screenToPage } from "./surface-coordinate-map.js";
import { SpatialWorkspaceController } from "./spatial-workspace-controller.js";
import type { ScreenPoint, ViewportController } from "./viewport-controller.js";

function interpolate(minimum: number, maximum: number, value: number): number {
  return minimum + (maximum - minimum) * value;
}

function eased(value: number): number {
  const unit = Math.max(0, Math.min(1, value));
  return unit * unit * (3 - 2 * unit);
}

export type SurfaceTarget = Readonly<{
  surfaceId: string;
  point: ScreenPoint;
}>;

export class CanvasSceneRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #viewport: ViewportController;
  readonly #spatial: SpatialWorkspaceController;
  readonly #snapshots = new Map<string, SurfaceSnapshot>();
  #boardSurfaceId: string;
  #activeInk: InkSession | undefined;
  #activeInkSurfaceId: string | undefined;
  #frame: number | undefined;
  #resizeObserver: ResizeObserver | undefined;
  #pixelRatio = 1;

  constructor(
    canvas: HTMLCanvasElement,
    snapshot: SurfaceSnapshot,
    viewport: ViewportController,
    spatial: SpatialWorkspaceController = new SpatialWorkspaceController(),
  ) {
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) throw new Error("Canvas 2D is unavailable.");
    this.#canvas = canvas;
    this.#context = context;
    this.#viewport = viewport;
    this.#spatial = spatial;
    this.#boardSurfaceId = snapshot.surfaceId;
    this.#snapshots.set(snapshot.surfaceId, snapshot);
    this.#resize();
    if (typeof ResizeObserver === "function") {
      this.#resizeObserver = new ResizeObserver(() => this.#resize());
      this.#resizeObserver.observe(canvas, { box: "device-pixel-content-box" });
    }
    this.#viewport.observe(() => this.requestFrame());
    this.#spatial.observe(() => this.requestFrame());
    this.requestFrame();
  }

  setSnapshot(snapshot: SurfaceSnapshot): void {
    this.#snapshots.set(snapshot.surfaceId, snapshot);
    this.requestFrame();
  }

  setBoardSurface(surfaceId: string): void {
    if (!this.#snapshots.has(surfaceId)) throw new RangeError(`Unknown board surface: ${surfaceId}`);
    this.#boardSurfaceId = surfaceId;
    this.requestFrame();
  }

  setActiveInk(session: InkSession | undefined, surfaceId?: string): void {
    this.#activeInk = session;
    this.#activeInkSurfaceId = session ? surfaceId : undefined;
    this.requestFrame();
  }

  items(): readonly WorkspaceItem[] {
    return Object.freeze(this.#boardSnapshot().elements
      .filter((element): element is WorkspaceItem => element.kind === "item")
      .sort((left, right) => left.z - right.z));
  }

  item(itemId: string): WorkspaceItem | undefined {
    return this.items().find((item) => item.id === itemId);
  }

  itemAtScreen(point: ScreenPoint): WorkspaceItem | undefined {
    return itemAtWorld(this.items(), this.#viewport.screenToWorld(point));
  }

  activeSurfaceId(): string {
    const state = this.#spatial.state();
    if (state.mode === "board") return this.#boardSurfaceId;
    const item = this.item(state.itemId);
    return item?.pageSurfaceIds[item.activePageIndex] ?? this.#boardSurfaceId;
  }

  resolveSurfaceTarget(point: ScreenPoint): SurfaceTarget {
    const state = this.#spatial.state();
    if (state.mode === "item") {
      return Object.freeze({
        surfaceId: this.activeSurfaceId(),
        point: screenToPage(point, this.#cssWidth(), this.#cssHeight()),
      });
    }
    const world = this.#viewport.screenToWorld(point);
    const item = itemAtWorld(this.items(), world);
    if (item) {
      const preview = this.#spatial.movePreview();
      const x = preview?.itemId === item.id ? preview.x : item.x;
      const y = preview?.itemId === item.id ? preview.y : item.y;
      return Object.freeze({
        surfaceId: item.coverSurfaceId,
        point: Object.freeze({ x: world.x - x, y: world.y - y }),
      });
    }
    return Object.freeze({ surfaceId: this.#boardSurfaceId, point: world });
  }

  mapScreenToSurface(point: ScreenPoint, surfaceId: string): ScreenPoint {
    if (surfaceId === this.#boardSurfaceId) return this.#viewport.screenToWorld(point);
    const state = this.#spatial.state();
    if (state.mode === "item" && surfaceId === this.activeSurfaceId()) {
      return screenToPage(point, this.#cssWidth(), this.#cssHeight());
    }
    const item = this.items().find((candidate) => candidate.coverSurfaceId === surfaceId);
    if (!item) throw new RangeError(`Surface ${surfaceId} is not visible.`);
    const world = this.#viewport.screenToWorld(point);
    const preview = this.#spatial.movePreview();
    const x = preview?.itemId === item.id ? preview.x : item.x;
    const y = preview?.itemId === item.id ? preview.y : item.y;
    return Object.freeze({ x: world.x - x, y: world.y - y });
  }

  requestFrame(): void {
    if (this.#frame !== undefined) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = undefined;
      this.#render();
    });
  }

  destroy(): void {
    this.#resizeObserver?.disconnect();
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame);
  }

  #resize(): void {
    const bounds = this.#canvas.getBoundingClientRect();
    this.#pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * this.#pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * this.#pixelRatio));
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
    this.requestFrame();
  }

  #render(): void {
    const context = this.#context;
    const width = this.#cssWidth();
    const height = this.#cssHeight();
    context.setTransform(this.#pixelRatio, 0, 0, this.#pixelRatio, 0, 0);
    context.globalAlpha = 1;
    const state = this.#spatial.state();
    if (state.mode === "item") {
      this.#drawOpenItem(state.itemId, width, height);
      return;
    }
    this.#drawBoard(width, height, state.mode === "entering" ? state.itemId : undefined);
    if (state.mode === "entering") this.#drawTransition(state.itemId, state.progress, width, height);
  }

  #drawBoard(width: number, height: number, omittedItemId?: string): void {
    const context = this.#context;
    context.fillStyle = "#e7e7e3";
    context.fillRect(0, 0, width, height);
    this.#drawDeskTexture(width, height);
    const viewport = this.#viewport.state();
    context.save();
    context.translate(viewport.x, viewport.y);
    context.scale(viewport.scale, viewport.scale);
    for (const element of this.#boardSnapshot().elements) {
      if (element.kind === "item" && element.id !== omittedItemId) this.#drawWorkspaceItem(element, viewport.scale);
      else this.#drawElement(element);
    }
    if (this.#activeInk && this.#activeInkSurfaceId === this.#boardSurfaceId) {
      this.#drawInk(this.#activeInk.stroke());
    }
    context.restore();
  }

  #drawWorkspaceItem(item: WorkspaceItem, viewportScale: number): void {
    const context = this.#context;
    const preview = this.#spatial.movePreview();
    const moving = preview?.itemId === item.id;
    const x = moving ? preview.x : item.x;
    const y = moving ? preview.y : item.y;
    const radius = 22;
    context.save();
    context.shadowColor = moving ? "rgba(20, 20, 18, 0.28)" : "rgba(20, 20, 18, 0.16)";
    context.shadowBlur = moving ? 34 / viewportScale : 18 / viewportScale;
    context.shadowOffsetY = moving ? 16 / viewportScale : 8 / viewportScale;
    context.fillStyle = item.itemKind === "document" ? "#fffef9" : "#f4efdf";
    context.beginPath();
    context.roundRect(x, y, item.width, item.height, radius);
    context.fill();
    context.shadowColor = "transparent";
    context.save();
    context.beginPath();
    context.roundRect(x, y, item.width, item.height, radius);
    context.clip();
    context.translate(x, y);
    const cover = this.#snapshots.get(item.coverSurfaceId);
    if (cover) this.#drawSurfaceElements(cover);
    if (this.#activeInk && this.#activeInkSurfaceId === item.coverSurfaceId) {
      this.#drawInk(this.#activeInk.stroke());
    }
    if (item.title && !cover?.elements.some((element) => element.kind === "markdown")) {
      context.fillStyle = "rgba(23, 23, 20, 0.62)";
      context.font = "600 28px ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(item.title, item.width / 2, item.height * 0.43, item.width * 0.78);
    }
    context.restore();
    if (this.#spatial.selectedItemId() === item.id) {
      context.strokeStyle = "rgba(23, 23, 20, 0.7)";
      context.lineWidth = 2 / viewportScale;
      context.beginPath();
      context.roundRect(x - 5 / viewportScale, y - 5 / viewportScale, item.width + 10 / viewportScale, item.height + 10 / viewportScale, radius + 4 / viewportScale);
      context.stroke();
    }
    context.restore();
  }

  #drawOpenItem(itemId: string, width: number, height: number): void {
    const item = this.item(itemId);
    if (!item) {
      this.#spatial.close();
      this.#drawBoard(width, height);
      return;
    }
    this.#drawPageMaterial(0, 0, width, height, 0);
    const transform = pageTransform(width, height);
    const context = this.#context;
    context.save();
    context.translate(transform.x, transform.y);
    context.scale(transform.scale, transform.scale);
    const surface = this.#snapshots.get(item.pageSurfaceIds[item.activePageIndex] ?? "");
    if (surface) this.#drawSurfaceElements(surface);
    if (this.#activeInk && this.#activeInkSurfaceId === surface?.surfaceId) this.#drawInk(this.#activeInk.stroke());
    context.restore();
  }

  #drawTransition(itemId: string, progress: number, width: number, height: number): void {
    const item = this.item(itemId);
    if (!item) return;
    const context = this.#context;
    const viewport = this.#viewport.state();
    const preview = this.#spatial.movePreview();
    const itemX = preview?.itemId === item.id ? preview.x : item.x;
    const itemY = preview?.itemId === item.id ? preview.y : item.y;
    const start = {
      x: viewport.x + itemX * viewport.scale,
      y: viewport.y + itemY * viewport.scale,
      width: item.width * viewport.scale,
      height: item.height * viewport.scale,
    };
    const t = eased(progress);
    const rect = {
      x: interpolate(start.x, 0, t),
      y: interpolate(start.y, 0, t),
      width: interpolate(start.width, width, t),
      height: interpolate(start.height, height, t),
    };
    const radius = interpolate(Math.min(24, 22 * viewport.scale), 0, t);
    context.save();
    context.beginPath();
    context.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    context.clip();
    this.#drawPageMaterial(rect.x, rect.y, rect.width, rect.height, radius);

    const coverAlpha = 1 - Math.pow(t, 4);
    if (coverAlpha > 0.01) {
      context.save();
      context.globalAlpha = coverAlpha;
      context.translate(rect.x, rect.y);
      context.scale(rect.width / item.width, rect.height / item.height);
      const cover = this.#snapshots.get(item.coverSurfaceId);
      if (cover) this.#drawSurfaceElements(cover);
      context.restore();
    }
    if (t > 0.2) {
      const pageAlpha = eased((t - 0.2) / 0.8);
      const transform = pageTransform(rect.width, rect.height);
      context.save();
      context.globalAlpha = pageAlpha;
      context.translate(rect.x + transform.x, rect.y + transform.y);
      context.scale(transform.scale, transform.scale);
      const page = this.#snapshots.get(item.pageSurfaceIds[item.activePageIndex] ?? "");
      if (page) this.#drawSurfaceElements(page);
      context.restore();
    }
    context.restore();
  }

  #drawPageMaterial(x: number, y: number, width: number, height: number, radius: number): void {
    const context = this.#context;
    context.save();
    if (radius > 0) {
      context.beginPath();
      context.roundRect(x, y, width, height, radius);
      context.clip();
    }
    context.fillStyle = "#fffef9";
    context.fillRect(x, y, width, height);
    const spacing = 18.8976378;
    context.strokeStyle = "rgba(139, 171, 188, 0.22)";
    context.lineWidth = 1;
    context.beginPath();
    for (let lineX = x + spacing; lineX < x + width; lineX += spacing) {
      context.moveTo(Math.round(lineX) + 0.5, y);
      context.lineTo(Math.round(lineX) + 0.5, y + height);
    }
    for (let lineY = y + spacing; lineY < y + height; lineY += spacing) {
      context.moveTo(x, Math.round(lineY) + 0.5);
      context.lineTo(x + width, Math.round(lineY) + 0.5);
    }
    context.stroke();
    context.restore();
  }

  #drawDeskTexture(width: number, height: number): void {
    const context = this.#context;
    context.save();
    context.fillStyle = "rgba(61, 66, 61, 0.105)";
    const spacing = 48;
    for (let y = 22; y < height; y += spacing) {
      const row = Math.floor(y / spacing);
      for (let x = 24 + (row % 2) * 7; x < width; x += spacing) {
        context.beginPath();
        context.arc(x, y, 0.7, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();
  }

  #drawSurfaceElements(snapshot: SurfaceSnapshot): void {
    for (const element of snapshot.elements) {
      if (element.kind !== "item") this.#drawElement(element);
    }
  }

  #drawElement(element: SceneElement): void {
    switch (element.kind) {
      case "ink":
        this.#drawInk(element);
        return;
      case "shape":
        this.#drawShape(element);
        return;
      case "markdown":
        this.#drawMarkdown(element);
        return;
      case "item":
        return;
    }
  }

  #drawInk(stroke: InkStroke): void {
    const context = this.#context;
    const points = stroke.points;
    if (points.length === 1) {
      const point = points[0];
      if (!point) return;
      context.save();
      context.globalAlpha = interpolate(stroke.style.minimumOpacity, stroke.style.maximumOpacity, point.pressure);
      context.fillStyle = stroke.style.color;
      context.beginPath();
      context.arc(point.x, point.y, stroke.style.width / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }
    context.save();
    context.strokeStyle = stroke.style.color;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      if (!previous || !point) continue;
      const pressure = (previous.pressure + point.pressure) / 2;
      context.globalAlpha = interpolate(stroke.style.minimumOpacity, stroke.style.maximumOpacity, pressure);
      context.lineWidth = stroke.style.width * interpolate(0.72, 1.18, pressure);
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.restore();
  }

  #drawShape(shape: ShapeElement): void {
    const context = this.#context;
    context.save();
    context.strokeStyle = shape.stroke;
    context.lineWidth = shape.strokeWidth;
    context.fillStyle = shape.fill ?? "transparent";
    context.beginPath();
    if (shape.shape === "line") {
      context.moveTo(shape.x, shape.y);
      context.lineTo(shape.x + shape.width, shape.y + shape.height);
    } else if (shape.shape === "rectangle") {
      context.rect(shape.x, shape.y, shape.width, shape.height);
    } else {
      context.ellipse(shape.x + shape.width / 2, shape.y + shape.height / 2, Math.abs(shape.width / 2), Math.abs(shape.height / 2), 0, 0, Math.PI * 2);
    }
    if (shape.fill) context.fill();
    context.stroke();
    context.restore();
  }

  #drawMarkdown(block: MarkdownBlock): void {
    const context = this.#context;
    context.save();
    context.fillStyle = block.color;
    context.font = `${block.fontSize}px ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textBaseline = "top";
    const words = block.source.replace(/^#+\s*/gm, "").split(/\s+/);
    let line = "";
    let y = block.y;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > block.width && line) {
        context.fillText(line, block.x, y);
        line = word;
        y += block.fontSize * 1.35;
      } else {
        line = candidate;
      }
    }
    if (line) context.fillText(line, block.x, y);
    context.restore();
  }

  #boardSnapshot(): SurfaceSnapshot {
    const snapshot = this.#snapshots.get(this.#boardSurfaceId);
    if (!snapshot) throw new Error("The board surface is unavailable.");
    return snapshot;
  }

  #cssWidth(): number {
    return this.#canvas.width / this.#pixelRatio;
  }

  #cssHeight(): number {
    return this.#canvas.height / this.#pixelRatio;
  }
}
