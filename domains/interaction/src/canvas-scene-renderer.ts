import type {
  EraseMask,
  InkStroke,
  MarkdownBlock,
  SceneElement,
  ScenePoint,
  ShapeElement,
  SurfaceSnapshot,
  WorkspaceItem,
} from "@foldthink/surface";
import type { InkSession } from "./ink-session.js";
import { eraserWidthAtPressure, inkOpacityAtPressure, inkWidthAtPressure } from "./ink-geometry.js";
import { InkSpatialIndex } from "./ink-spatial-index.js";
import { pageGridSpacing } from "./page-grid.js";
import { itemAtWorld, pageSize, pageTransform, screenToPage } from "./surface-coordinate-map.js";
import { SpatialWorkspaceController } from "./spatial-workspace-controller.js";
import type { ScreenPoint, ViewportController } from "./viewport-controller.js";

function interpolate(minimum: number, maximum: number, value: number): number {
  return minimum + (maximum - minimum) * value;
}

function eased(value: number): number {
  const unit = Math.max(0, Math.min(1, value));
  return unit * unit * (3 - 2 * unit);
}

type BrushVertex = Readonly<{
  point: ScenePoint;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  radius: number;
  opacity: number;
  tangentAngle: number;
}>;

function visibleStrokePoints(points: readonly ScenePoint[]): readonly ScenePoint[] {
  const visible: ScenePoint[] = [];
  for (const point of points) {
    const previous = visible.at(-1);
    if (previous && previous.x === point.x && previous.y === point.y) visible[visible.length - 1] = point;
    else visible.push(point);
  }
  return visible;
}

function smoothedPressure(points: readonly ScenePoint[], index: number): number {
  const point = points[index];
  if (!point) return 0.5;
  const previous = points[index - 1] ?? point;
  const next = points[index + 1] ?? point;
  return (previous.pressure + point.pressure * 2 + next.pressure) / 4;
}

function brushVertices(stroke: InkStroke): readonly BrushVertex[] {
  const points = visibleStrokePoints(stroke.points);
  return points.map((point, index) => {
    const previous = points[index - 1] ?? point;
    const next = points[index + 1] ?? point;
    let dx = next.x - previous.x;
    let dy = next.y - previous.y;
    let length = Math.hypot(dx, dy);
    if (length <= Number.EPSILON) {
      dx = 1;
      dy = 0;
      length = 1;
    }
    const pressure = smoothedPressure(points, index);
    const radius = inkWidthAtPressure(stroke, pressure) / 2;
    const normalX = -dy / length;
    const normalY = dx / length;
    return Object.freeze({
      point,
      leftX: point.x + normalX * radius,
      leftY: point.y + normalY * radius,
      rightX: point.x - normalX * radius,
      rightY: point.y - normalY * radius,
      radius,
      opacity: inkOpacityAtPressure(stroke, pressure),
      tangentAngle: Math.atan2(dy, dx),
    });
  });
}

function colorAtOpacity(color: string, opacity: number): string | undefined {
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/iu.exec(color);
  const longHex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(color);
  const channels = longHex
    ? longHex.slice(1).map((channel) => Number.parseInt(channel, 16))
    : shortHex
      ? shortHex.slice(1).map((channel) => Number.parseInt(`${channel}${channel}`, 16))
      : undefined;
  if (!channels || channels.length !== 3) return undefined;
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${opacity})`;
}

export type SurfaceTarget = Readonly<{
  surfaceId: string;
  point: ScreenPoint;
}>;

export class CanvasSceneRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #baseLayer: HTMLCanvasElement;
  readonly #baseContext: CanvasRenderingContext2D;
  readonly #inkLayer: HTMLCanvasElement;
  readonly #inkContext: CanvasRenderingContext2D;
  readonly #strokeLayer: HTMLCanvasElement;
  readonly #strokeContext: CanvasRenderingContext2D;
  readonly #viewport: ViewportController;
  readonly #spatial: SpatialWorkspaceController;
  readonly #stopViewportObservation: () => void;
  readonly #stopSpatialObservation: () => void;
  readonly #snapshots = new Map<string, SurfaceSnapshot>();
  readonly #inkIndexes = new Map<string, InkSpatialIndex>();
  #boardSurfaceId: string;
  #activeInk: InkSession | undefined;
  #activeInkSurfaceId: string | undefined;
  #activeErase: EraseMask | undefined;
  #activeEraseSurfaceId: string | undefined;
  #frame: number | undefined;
  #resizeObserver: ResizeObserver | undefined;
  #pixelRatio = 1;
  #baseValid = false;

  constructor(
    canvas: HTMLCanvasElement,
    snapshot: SurfaceSnapshot,
    viewport: ViewportController,
    spatial: SpatialWorkspaceController = new SpatialWorkspaceController(),
  ) {
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) throw new Error("Canvas 2D is unavailable.");
    const baseLayer = document.createElement("canvas");
    const baseContext = baseLayer.getContext("2d", { alpha: false });
    const inkLayer = document.createElement("canvas");
    const inkContext = inkLayer.getContext("2d", { alpha: true });
    const strokeLayer = document.createElement("canvas");
    const strokeContext = strokeLayer.getContext("2d", { alpha: true });
    if (!baseContext || !inkContext || !strokeContext) throw new Error("Canvas frame layers are unavailable.");
    this.#canvas = canvas;
    this.#context = context;
    this.#baseLayer = baseLayer;
    this.#baseContext = baseContext;
    this.#inkLayer = inkLayer;
    this.#inkContext = inkContext;
    this.#strokeLayer = strokeLayer;
    this.#strokeContext = strokeContext;
    this.#viewport = viewport;
    this.#spatial = spatial;
    this.#boardSurfaceId = snapshot.surfaceId;
    this.#snapshots.set(snapshot.surfaceId, snapshot);
    this.#inkIndexes.set(snapshot.surfaceId, this.#createInkIndex(snapshot));
    this.#resize();
    if (typeof ResizeObserver === "function") {
      this.#resizeObserver = new ResizeObserver(() => this.#resize());
      this.#resizeObserver.observe(canvas, { box: "device-pixel-content-box" });
    }
    this.#stopViewportObservation = this.#viewport.observe(() => this.#invalidateBase());
    this.#stopSpatialObservation = this.#spatial.observe(() => this.#invalidateBase());
    this.requestFrame();
  }

  setSnapshot(snapshot: SurfaceSnapshot): void {
    this.#snapshots.set(snapshot.surfaceId, snapshot);
    this.#inkIndexes.set(snapshot.surfaceId, this.#createInkIndex(snapshot));
    this.#invalidateBase();
  }

  setBoardSurface(surfaceId: string): void {
    if (!this.#snapshots.has(surfaceId)) throw new RangeError(`Unknown board surface: ${surfaceId}`);
    this.#boardSurfaceId = surfaceId;
    this.#invalidateBase();
  }

  setActiveInk(session: InkSession | undefined, surfaceId?: string): void {
    this.#activeInk = session;
    this.#activeInkSurfaceId = session ? surfaceId : undefined;
    this.requestFrame();
  }

  setActiveErase(mask: EraseMask | undefined, surfaceId?: string): void {
    this.#activeErase = mask;
    this.#activeEraseSurfaceId = mask ? surfaceId : undefined;
    this.requestFrame();
  }

  inkIndex(surfaceId: string): InkSpatialIndex {
    const index = this.#inkIndexes.get(surfaceId);
    if (!index) throw new RangeError(`Unknown surface: ${surfaceId}`);
    return index;
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
    this.#stopViewportObservation();
    this.#stopSpatialObservation();
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
      this.#baseValid = false;
    }
    if (this.#baseLayer.width !== width || this.#baseLayer.height !== height) {
      this.#baseLayer.width = width;
      this.#baseLayer.height = height;
      this.#baseValid = false;
    }
    if (this.#inkLayer.width !== width || this.#inkLayer.height !== height) {
      this.#inkLayer.width = width;
      this.#inkLayer.height = height;
    }
    if (this.#strokeLayer.width !== width || this.#strokeLayer.height !== height) {
      this.#strokeLayer.width = width;
      this.#strokeLayer.height = height;
    }
    this.requestFrame();
  }

  #render(): void {
    if (this.#activeInk && !this.#activeErase && this.#baseValid) {
      this.#restoreBase();
      this.#drawActiveInkOverlay();
      return;
    }
    this.#drawCompleteFrame();
    if (!this.#activeInk && !this.#activeErase) this.#captureBase();
  }

  #drawCompleteFrame(): void {
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

  #drawActiveInkOverlay(): void {
    const ink = this.#activeInk;
    const surfaceId = this.#activeInkSurfaceId;
    if (!ink || !surfaceId) return;
    const context = this.#context;
    context.setTransform(this.#pixelRatio, 0, 0, this.#pixelRatio, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    const state = this.#spatial.state();
    if (state.mode === "board") {
      const viewport = this.#viewport.state();
      context.save();
      context.translate(viewport.x, viewport.y);
      context.scale(viewport.scale, viewport.scale);
      if (surfaceId === this.#boardSurfaceId) {
        this.#drawInk(ink.displayStroke());
      } else {
        const item = this.items().find((candidate) => candidate.coverSurfaceId === surfaceId);
        if (item) {
          const preview = this.#spatial.movePreview();
          const x = preview?.itemId === item.id ? preview.x : item.x;
          const y = preview?.itemId === item.id ? preview.y : item.y;
          context.save();
          context.beginPath();
          context.roundRect(x, y, item.width, item.height, 22);
          context.clip();
          context.translate(x, y);
          this.#drawInk(ink.displayStroke());
          context.restore();
        }
      }
      context.restore();
      return;
    }
    if (state.mode === "item" && surfaceId === this.activeSurfaceId()) {
      const transform = pageTransform(this.#cssWidth(), this.#cssHeight());
      context.save();
      context.translate(transform.x, transform.y);
      context.scale(transform.scale, transform.scale);
      this.#drawInk(ink.displayStroke());
      context.restore();
    }
  }

  #invalidateBase(): void {
    this.#baseValid = false;
    this.requestFrame();
  }

  #captureBase(): void {
    const context = this.#baseContext;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "copy";
    context.drawImage(this.#canvas, 0, 0);
    context.restore();
    this.#baseValid = true;
  }

  #restoreBase(): void {
    const context = this.#context;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "copy";
    context.drawImage(this.#baseLayer, 0, 0);
    context.restore();
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
    this.#drawSurfaceElements(this.#boardSnapshot());
    for (const item of this.items()) {
      if (item.id !== omittedItemId) this.#drawWorkspaceItem(item, viewport.scale);
    }
    if (this.#activeInk && this.#activeInkSurfaceId === this.#boardSurfaceId) {
      this.#drawInk(this.#activeInk.displayStroke());
    }
    this.#drawActiveEraser(this.#boardSurfaceId);
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
      this.#drawInk(this.#activeInk.displayStroke());
    }
    this.#drawActiveEraser(item.coverSurfaceId);
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
    const transform = pageTransform(width, height);
    const context = this.#context;
    context.fillStyle = "#fffef9";
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(transform.x, transform.y);
    context.scale(transform.scale, transform.scale);
    this.#drawPageMaterial(0, 0, pageSize.width, pageSize.height, 0);
    const surface = this.#snapshots.get(item.pageSurfaceIds[item.activePageIndex] ?? "");
    if (surface) this.#drawSurfaceElements(surface);
    if (this.#activeInk && this.#activeInkSurfaceId === surface?.surfaceId) this.#drawInk(this.#activeInk.displayStroke());
    if (surface) this.#drawActiveEraser(surface.surfaceId);
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
    const transform = pageTransform(rect.width, rect.height);
    context.save();
    context.translate(rect.x + transform.x, rect.y + transform.y);
    context.scale(transform.scale, transform.scale);
    this.#drawPageMaterial(0, 0, pageSize.width, pageSize.height, 0);
    context.restore();

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
    const transform = context.getTransform();
    const cssScale = Math.max(0.001, Math.hypot(transform.a, transform.b) / this.#pixelRatio);
    context.strokeStyle = "rgba(139, 171, 188, 0.22)";
    context.lineWidth = 1 / cssScale;
    context.beginPath();
    for (let lineX = x + pageGridSpacing; lineX < x + width; lineX += pageGridSpacing) {
      context.moveTo(lineX, y);
      context.lineTo(lineX, y + height);
    }
    for (let lineY = y + pageGridSpacing; lineY < y + height; lineY += pageGridSpacing) {
      context.moveTo(x, lineY);
      context.lineTo(x + width, lineY);
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
    const strokes = snapshot.elements.filter((element): element is InkStroke => element.kind === "ink");
    const masks = snapshot.elements.filter((element): element is EraseMask => element.kind === "erase");
    if (this.#activeErase && this.#activeEraseSurfaceId === snapshot.surfaceId) masks.push(this.#activeErase);
    this.#drawInkComposition(strokes, masks);
    for (const element of snapshot.elements) {
      if (element.kind !== "item" && element.kind !== "ink" && element.kind !== "erase") {
        this.#drawElement(element);
      }
    }
  }

  #drawElement(element: SceneElement): void {
    switch (element.kind) {
      case "ink":
        this.#drawInk(element);
        return;
      case "erase":
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
    this.#drawInkTo(this.#context, stroke);
  }

  #drawInkComposition(strokes: readonly InkStroke[], masks: readonly EraseMask[]): void {
    if (strokes.length === 0) return;
    const main = this.#context;
    const transform = main.getTransform();
    this.#clearLayer(this.#inkContext);
    this.#inkContext.setTransform(transform);
    const masksByStroke = new Map<string, EraseMask[]>();
    for (const mask of masks) {
      for (const strokeId of mask.affectedStrokeIds) {
        const strokeMasks = masksByStroke.get(strokeId) ?? [];
        strokeMasks.push(mask);
        masksByStroke.set(strokeId, strokeMasks);
      }
    }

    for (const stroke of strokes) {
      const strokeMasks = masksByStroke.get(stroke.id);
      if (!strokeMasks || strokeMasks.length === 0) {
        this.#inkContext.setTransform(transform);
        this.#inkContext.globalCompositeOperation = "source-over";
        this.#drawInkTo(this.#inkContext, stroke);
        continue;
      }
      this.#clearLayer(this.#strokeContext);
      this.#strokeContext.setTransform(transform);
      this.#strokeContext.globalCompositeOperation = "source-over";
      this.#drawInkTo(this.#strokeContext, stroke);
      this.#strokeContext.globalCompositeOperation = "destination-out";
      for (const mask of strokeMasks) this.#drawEraseTo(this.#strokeContext, mask);
      this.#inkContext.save();
      this.#inkContext.setTransform(1, 0, 0, 1, 0, 0);
      this.#inkContext.globalAlpha = 1;
      this.#inkContext.globalCompositeOperation = "source-over";
      this.#inkContext.drawImage(this.#strokeLayer, 0, 0);
      this.#inkContext.restore();
    }

    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(this.#inkLayer, 0, 0);
    main.restore();
  }

  #clearLayer(context: CanvasRenderingContext2D): void {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.restore();
  }

  #drawInkTo(context: CanvasRenderingContext2D, stroke: InkStroke): void {
    const vertices = brushVertices(stroke);
    if (vertices.length === 1) {
      const vertex = vertices[0];
      if (!vertex) return;
      context.save();
      context.globalAlpha = vertex.opacity;
      context.fillStyle = stroke.style.color;
      context.beginPath();
      context.arc(vertex.point.x, vertex.point.y, vertex.radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }
    context.save();
    for (let index = 1; index < vertices.length; index += 1) {
      const previous = vertices[index - 1];
      const vertex = vertices[index];
      if (!previous || !vertex) continue;
      const startColor = colorAtOpacity(stroke.style.color, previous.opacity);
      const endColor = colorAtOpacity(stroke.style.color, vertex.opacity);
      if (startColor && endColor) {
        const gradient = context.createLinearGradient(
          previous.point.x,
          previous.point.y,
          vertex.point.x,
          vertex.point.y,
        );
        gradient.addColorStop(0, startColor);
        gradient.addColorStop(1, endColor);
        context.globalAlpha = 1;
        context.fillStyle = gradient;
      } else {
        context.globalAlpha = (previous.opacity + vertex.opacity) / 2;
        context.fillStyle = stroke.style.color;
      }
      context.beginPath();
      context.moveTo(previous.leftX, previous.leftY);
      context.lineTo(previous.rightX, previous.rightY);
      context.lineTo(vertex.rightX, vertex.rightY);
      context.lineTo(vertex.leftX, vertex.leftY);
      context.closePath();
      context.fill();
    }
    const first = vertices[0];
    const last = vertices.at(-1);
    if (first) this.#drawInkCap(context, stroke.style.color, first, "start");
    if (last) this.#drawInkCap(context, stroke.style.color, last, "end");
    context.restore();
  }

  #drawInkCap(
    context: CanvasRenderingContext2D,
    color: string,
    vertex: BrushVertex,
    side: "start" | "end",
  ): void {
    context.globalAlpha = vertex.opacity;
    context.fillStyle = color;
    const startAngle = side === "start"
      ? vertex.tangentAngle + Math.PI / 2
      : vertex.tangentAngle - Math.PI / 2;
    context.beginPath();
    context.moveTo(
      vertex.point.x + Math.cos(startAngle) * vertex.radius,
      vertex.point.y + Math.sin(startAngle) * vertex.radius,
    );
    context.arc(
      vertex.point.x,
      vertex.point.y,
      vertex.radius,
      startAngle,
      startAngle + Math.PI,
    );
    context.closePath();
    context.fill();
  }

  #drawEraseTo(context: CanvasRenderingContext2D, mask: EraseMask): void {
    const points = mask.points;
    context.save();
    context.strokeStyle = "#000000";
    context.fillStyle = "#000000";
    context.globalAlpha = 1;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (points.length === 1) {
      const point = points[0];
      if (point) {
        context.beginPath();
        context.arc(point.x, point.y, eraserWidthAtPressure(mask.style, point.pressure) / 2, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const point = points[index];
        if (!previous || !point) continue;
        context.lineWidth = eraserWidthAtPressure(mask.style, (previous.pressure + point.pressure) / 2);
        context.beginPath();
        context.moveTo(previous.x, previous.y);
        context.lineTo(point.x, point.y);
        context.stroke();
      }
    }
    context.restore();
  }

  #drawActiveEraser(surfaceId: string): void {
    const mask = this.#activeEraseSurfaceId === surfaceId ? this.#activeErase : undefined;
    const point = mask?.points.at(-1);
    if (!mask || !point) return;
    const context = this.#context;
    const transform = context.getTransform();
    const cssScale = Math.max(0.001, Math.hypot(transform.a, transform.b) / this.#pixelRatio);
    context.save();
    context.globalAlpha = 0.72;
    context.fillStyle = "rgba(255, 255, 252, 0.72)";
    context.strokeStyle = "rgba(23, 23, 20, 0.62)";
    context.lineWidth = 1.25 / cssScale;
    context.beginPath();
    context.arc(point.x, point.y, eraserWidthAtPressure(mask.style, point.pressure) / 2, 0, Math.PI * 2);
    context.fill();
    context.stroke();
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

  #createInkIndex(snapshot: SurfaceSnapshot): InkSpatialIndex {
    return new InkSpatialIndex(
      snapshot.elements.filter((element): element is InkStroke => element.kind === "ink"),
    );
  }

  #cssWidth(): number {
    return this.#canvas.width / this.#pixelRatio;
  }

  #cssHeight(): number {
    return this.#canvas.height / this.#pixelRatio;
  }
}
