import { validateSceneElement, type WidgetBlock, type WidgetState } from "@foldthink/surface";
import { parseWidgetMessage } from "./widget-message.js";

export type WidgetHostOptions = Readonly<{
  block: WidgetBlock;
  parent: HTMLElement;
  onState(state: WidgetState): void;
  onEdit(): void;
  onError?(message: string): void;
}>;

export class WidgetHost {
  readonly iframe: HTMLIFrameElement;
  readonly #block: WidgetBlock;
  readonly #channel = crypto.randomUUID();
  readonly #options: WidgetHostOptions;

  constructor(options: WidgetHostOptions) {
    this.#options = options;
    this.#block = options.block;
    const iframe = document.createElement("iframe");
    iframe.className = "foldthink-widget-frame";
    iframe.title = `Interactive document block ${options.block.id}`;
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.src = "/widget-frame.html";
    this.iframe = iframe;
    window.addEventListener("message", this.#message);
    options.parent.append(iframe);
  }

  destroy(): void {
    window.removeEventListener("message", this.#message);
    this.iframe.remove();
  }

  readonly #initialize = (): void => {
    this.iframe.contentWindow?.postMessage({
      protocolVersion: 1,
      kind: "initialize",
      channel: this.#channel,
      html: this.#block.html,
      css: this.#block.css,
      javascript: this.#block.javascript,
      state: structuredClone(this.#block.state),
    }, "*");
  };

  readonly #message = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.iframe.contentWindow || event.origin !== "null") return;
    if (
      typeof event.data === "object" &&
      event.data !== null &&
      "protocolVersion" in event.data &&
      event.data.protocolVersion === 1 &&
      "kind" in event.data &&
      event.data.kind === "frameReady"
    ) {
      this.#initialize();
      return;
    }
    const message = parseWidgetMessage(event.data, this.#channel);
    if (!message) return;
    if (message.kind === "edit") {
      this.#options.onEdit();
      return;
    }
    if (message.kind === "error") {
      this.iframe.dataset.error = "true";
      this.#options.onError?.(message.message);
      return;
    }
    if (message.kind !== "setState") return;
    try {
      validateSceneElement({ ...this.#block, state: message.state });
      this.#options.onState(structuredClone(message.state));
    } catch {
      this.#options.onError?.("The interactive block returned invalid state.");
    }
  };
}
