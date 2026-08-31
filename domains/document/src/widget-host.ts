import { validateSceneElement, type WidgetBlock, type WidgetState } from "@foldthink/surface";
import { parseWidgetMessage } from "./widget-message.js";

export type WidgetHostOptions = Readonly<{
  block: WidgetBlock;
  parent: HTMLElement;
  onState(state: WidgetState): void;
  onEdit(): void;
  onError?(message: string): void;
}>;

function base64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function widgetDocument(block: WidgetBlock, channel: string): string {
  const payload = base64Json({
    channel,
    html: block.html,
    css: block.css,
    javascript: block.javascript,
    state: block.state,
  });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body,#foldthink-root{width:100%;height:100%;margin:0;overflow:hidden}*{box-sizing:border-box}</style></head>
<body><style id="foldthink-style"></style><div id="foldthink-root"></div>
<script>(()=>{"use strict";
const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("${payload}"),c=>c.charCodeAt(0))));
const send=(kind,value={})=>parent.postMessage({protocolVersion:1,channel:payload.channel,kind,...value},"*");
const clone=value=>JSON.parse(JSON.stringify(value));
const api=Object.freeze({state:clone(payload.state),setState(state){send("setState",{state:clone(state)})},edit(){send("edit")}});
document.getElementById("foldthink-style").textContent=payload.css;
document.getElementById("foldthink-root").innerHTML=payload.html;
addEventListener("dblclick",()=>send("edit"),{capture:true});
try{Function("foldthink","'use strict';\\n"+payload.javascript)(api);send("ready")}catch(error){send("error",{message:String(error).slice(0,1000)})}
})()</script></body></html>`;
}

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
    iframe.srcdoc = widgetDocument(options.block, this.#channel);
    this.iframe = iframe;
    options.parent.append(iframe);
    window.addEventListener("message", this.#message);
  }

  destroy(): void {
    window.removeEventListener("message", this.#message);
    this.iframe.remove();
  }

  readonly #message = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.iframe.contentWindow || event.origin !== "null") return;
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
