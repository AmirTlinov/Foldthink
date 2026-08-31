import type {
  InkStroke,
  MarkdownBlock,
  SceneElement,
  ShapeElement,
  SurfaceSnapshot,
} from "@foldthink/surface";
import type { InkSession } from "./ink-session.js";
import type { ViewportController } from "./viewport-controller.js";

function interpolate(minimum: number, maximum: number, value: number): number {
  return minimum + (maximum - minimum) * value;
}

export class CanvasSceneRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #viewport: ViewportController;
  #snapshot: SurfaceSnapshot;
  #activeInk: InkSession | undefined;
  #frame: number | undefined;
  #resizeObserver: ResizeObserver | undefined;
  #pixelRatio = 1;

  constructor(
    canvas: HTMLCanvasElement,
    snapshot: SurfaceSnapshot,
    viewport: ViewportController,
  ) {
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) {
      throw new Error("Canvas 2D is unavailable.");
    }
    this.#canvas = canvas;
    this.#context = context;
    this.#snapshot = snapshot;
    this.#viewport = viewport;
    this.#resize();
    if (typeof ResizeObserver === "function") {
      this.#resizeObserver = new ResizeObserver(() => this.#resize());
      this.#resizeObserver.observe(canvas, { box: "device-pixel-content-box" });
    }
    this.#viewport.observe(() => this.requestFrame());
    this.requestFrame();
  }

  setSnapshot(snapshot: SurfaceSnapshot): void {
    this.#snapshot = snapshot;
    this.requestFrame();
  }

  setActiveInk(session: InkSession | undefined): void {
    this.#activeInk = session;
    this.requestFrame();
  }

  requestFrame(): void {
    if (this.#frame !== undefined) {
      return;
    }
    this.#frame = requestAnimationFrame(() => {
      this.#frame = undefined;
      this.#render();
    });
  }

  destroy(): void {
    this.#resizeObserver?.disconnect();
    if (this.#frame !== undefined) {
      cancelAnimationFrame(this.#frame);
    }
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
    const cssWidth = this.#canvas.width / this.#pixelRatio;
    const cssHeight = this.#canvas.height / this.#pixelRatio;
    context.setTransform(this.#pixelRatio, 0, 0, this.#pixelRatio, 0, 0);
    context.globalAlpha = 1;
    context.fillStyle = "#e7e7e3";
    context.fillRect(0, 0, cssWidth, cssHeight);
    this.#drawDeskTexture(cssWidth, cssHeight);

    const viewport = this.#viewport.state();
    context.save();
    context.translate(viewport.x, viewport.y);
    context.scale(viewport.scale, viewport.scale);
    for (const element of this.#snapshot.elements) {
      this.#drawElement(element);
    }
    if (this.#activeInk) {
      this.#drawInk(this.#activeInk.stroke());
    }
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
    }
  }

  #drawInk(stroke: InkStroke): void {
    const context = this.#context;
    const points = stroke.points;
    if (points.length === 1) {
      const point = points[0];
      if (!point) return;
      context.save();
      context.globalAlpha = interpolate(
        stroke.style.minimumOpacity,
        stroke.style.maximumOpacity,
        point.pressure,
      );
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
      context.globalAlpha = interpolate(
        stroke.style.minimumOpacity,
        stroke.style.maximumOpacity,
        pressure,
      );
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
      context.ellipse(
        shape.x + shape.width / 2,
        shape.y + shape.height / 2,
        Math.abs(shape.width / 2),
        Math.abs(shape.height / 2),
        0,
        0,
        Math.PI * 2,
      );
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
}
