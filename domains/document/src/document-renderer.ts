import { AssetClient } from "@foldthink/asset/browser";
import {
  type AssetBlock,
  type LatexBlock,
  type MarkdownBlock,
  type SceneElement,
  type SurfaceSnapshot,
  type WidgetBlock,
} from "@foldthink/surface";
import type { WorkspaceRuntime } from "@foldthink/workspace";
import katex from "katex";
import { LatexCompilationClient } from "./latex-compilation-client.js";
import { renderMarkdown } from "./markdown-pipeline.js";
import { WidgetHost } from "./widget-host.js";

export type DocumentViewport = Readonly<{
  surfaceId: string;
  x: number;
  y: number;
  scale: number;
  width: number;
  height: number;
}>;

export type EditableDocumentBlock = MarkdownBlock | LatexBlock | WidgetBlock | AssetBlock;

export type DocumentPoint = Readonly<{
  x: number;
  y: number;
}>;

export type DocumentEditRequest = Readonly<{
  surfaceId: string;
  point: DocumentPoint;
  block?: EditableDocumentBlock;
}>;

export type DocumentRendererOptions = Readonly<{
  root: HTMLElement;
  runtime: WorkspaceRuntime;
  assets: AssetClient;
  latex: LatexCompilationClient;
  onEdit(request: DocumentEditRequest): void;
  onStatus?(status: string): void;
}>;

type RenderedBlock = Readonly<{
  element: EditableDocumentBlock;
  node: HTMLElement;
  destroy(): void;
}>;

function isDocumentBlock(element: SceneElement): element is EditableDocumentBlock {
  return element.kind === "markdown" ||
    element.kind === "latex" ||
    element.kind === "widget" ||
    element.kind === "asset";
}

function position(node: HTMLElement, block: EditableDocumentBlock): void {
  node.style.left = `${block.x}px`;
  node.style.top = `${block.y}px`;
  node.style.width = `${block.width}px`;
  if (block.kind !== "markdown" || block.height !== undefined) {
    node.style.height = `${block.height}px`;
  }
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : "This block could not be rendered.").slice(0, 1_000);
}

export class DocumentRenderer {
  readonly #options: DocumentRendererOptions;
  readonly #page: HTMLDivElement;
  readonly #blocks = new Map<string, RenderedBlock>();
  #snapshot: SurfaceSnapshot | undefined;

  constructor(options: DocumentRendererOptions) {
    this.#options = options;
    this.#page = document.createElement("div");
    this.#page.className = "foldthink-document-page";
    options.root.append(this.#page);
  }

  show(snapshot: SurfaceSnapshot | undefined, viewport: DocumentViewport | undefined): void {
    if (!snapshot || !viewport || snapshot.surfaceId !== viewport.surfaceId) {
      this.clear();
      return;
    }
    this.#snapshot = snapshot;
    this.#options.root.dataset.visible = "true";
    this.#page.style.width = `${viewport.width}px`;
    this.#page.style.height = `${viewport.height}px`;
    this.#page.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    const desired = snapshot.elements.filter(isDocumentBlock)
      .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
    const desiredIds = new Set(desired.map((block) => block.id));
    for (const [id, rendered] of this.#blocks) {
      const next = desired.find((block) => block.id === id);
      if (!desiredIds.has(id) || !next || next.version !== rendered.element.version || next.kind !== rendered.element.kind) {
        rendered.destroy();
        this.#blocks.delete(id);
      }
    }
    for (const block of desired) {
      let rendered = this.#blocks.get(block.id);
      if (!rendered) {
        rendered = this.#render(block, snapshot.surfaceId);
        this.#blocks.set(block.id, rendered);
      }
      this.#page.append(rendered.node);
    }
  }

  editAt(point: DocumentPoint): void {
    const snapshot = this.#snapshot;
    if (!snapshot) return;
    const candidates = [...this.#blocks.values()].reverse();
    const rendered = candidates.find(({ element, node }) => {
      const height = element.kind === "markdown"
        ? element.height ?? Math.max(44, node.offsetHeight)
        : element.height;
      return point.x >= element.x &&
        point.x <= element.x + element.width &&
        point.y >= element.y &&
        point.y <= element.y + height;
    });
    this.#options.onEdit(Object.freeze({
      surfaceId: snapshot.surfaceId,
      point,
      ...(rendered ? { block: rendered.element } : {}),
    }));
  }

  clear(): void {
    this.#snapshot = undefined;
    delete this.#options.root.dataset.visible;
    for (const rendered of this.#blocks.values()) rendered.destroy();
    this.#blocks.clear();
  }

  destroy(): void {
    this.clear();
    this.#page.remove();
  }

  #render(block: EditableDocumentBlock, surfaceId: string): RenderedBlock {
    const node = document.createElement("article");
    node.className = `foldthink-document-block foldthink-${block.kind}-block`;
    node.dataset.blockId = block.id;
    position(node, block);
    if (block.kind === "markdown") return this.#renderMarkdown(node, block);
    if (block.kind === "latex") return this.#renderLatex(node, block);
    if (block.kind === "asset") return this.#renderAsset(node, block);
    return this.#renderWidget(node, block, surfaceId);
  }

  #renderMarkdown(node: HTMLElement, block: MarkdownBlock): RenderedBlock {
    node.style.color = block.color;
    node.style.fontSize = `${block.fontSize}px`;
    node.ariaLabel = "Editable Markdown block";
    node.textContent = "Rendering…";
    let alive = true;
    void renderMarkdown(block.source).then((html) => {
      if (!alive) return;
      node.innerHTML = html;
    }).catch((error: unknown) => {
      if (!alive) return;
      node.classList.add("foldthink-document-error");
      node.textContent = boundedError(error);
    });
    return Object.freeze({
      element: block,
      node,
      destroy(): void {
        alive = false;
        node.remove();
      },
    });
  }

  #renderLatex(node: HTMLElement, block: LatexBlock): RenderedBlock {
    node.style.color = block.color;
    node.style.fontSize = `${block.fontSize}px`;
    node.ariaLabel = "Editable LaTeX block";
    if (block.mode === "math") {
      try {
        node.innerHTML = katex.renderToString(block.source, {
          displayMode: true,
          trust: false,
          strict: "error",
          throwOnError: true,
          maxSize: 20,
          maxExpand: 1_000,
        });
      } catch (error) {
        node.classList.add("foldthink-document-error");
        node.textContent = boundedError(error);
      }
      return Object.freeze({ element: block, node, destroy: () => node.remove() });
    }
    const controller = new AbortController();
    const objectUrls: string[] = [];
    node.textContent = "Typesetting…";
    void this.#options.latex.compile(block.source, controller.signal).then(async (compilation) => {
      const pages = await Promise.all(compilation.pages.map(async (page, index) => {
        const blob = await this.#options.assets.blob(page.assetId, controller.signal);
        if (controller.signal.aborted) return undefined;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        const image = document.createElement("img");
        image.src = url;
        image.alt = `LaTeX page ${index + 1} of ${compilation.pages.length}`;
        image.width = page.width;
        image.height = page.height;
        return image;
      }));
      if (controller.signal.aborted) {
        for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);
        return;
      }
      const images = pages.filter((page): page is HTMLImageElement => page !== undefined);
      node.replaceChildren(...images);
      node.dataset.pageCount = String(images.length);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      node.classList.add("foldthink-document-error");
      node.textContent = boundedError(error);
    });
    return Object.freeze({
      element: block,
      node,
      destroy(): void {
        controller.abort();
        for (const url of objectUrls) URL.revokeObjectURL(url);
        node.remove();
      },
    });
  }

  #renderAsset(node: HTMLElement, block: AssetBlock): RenderedBlock {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    node.textContent = "Loading asset…";
    void this.#options.assets.blob(block.assetId, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      if (!blob.type.startsWith("image/")) {
        node.textContent = block.alt || "Attachment";
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = block.alt;
      image.style.objectFit = block.fit;
      node.replaceChildren(image);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      node.classList.add("foldthink-document-error");
      node.textContent = boundedError(error);
    });
    return Object.freeze({
      element: block,
      node,
      destroy(): void {
        controller.abort();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        node.remove();
      },
    });
  }

  #renderWidget(node: HTMLElement, block: WidgetBlock, surfaceId: string): RenderedBlock {
    node.ariaLabel = "Interactive document block";
    let stateWrites = Promise.resolve();
    const host = new WidgetHost({
      block,
      parent: node,
      onEdit: () => this.#options.onEdit(Object.freeze({
        surfaceId,
        point: Object.freeze({ x: block.x, y: block.y }),
        block,
      })),
      onState: (state) => {
        stateWrites = stateWrites.then(async () => {
          const current = this.#options.runtime.inspect(surfaceId).elements
            .find((element): element is WidgetBlock => element.id === block.id && element.kind === "widget");
          if (!current) return;
          await this.#options.runtime.dispatch({
            kind: "patchSurface",
            surfaceId,
            changes: [{
              action: "put",
              expectedVersion: current.version,
              element: { ...current, state },
            }],
          });
        }).catch(() => this.#options.onStatus?.("Interactive state could not be saved"));
      },
      onError: (message) => this.#options.onStatus?.(message),
    });
    return Object.freeze({
      element: block,
      node,
      destroy(): void {
        host.destroy();
        node.remove();
      },
    });
  }
}
