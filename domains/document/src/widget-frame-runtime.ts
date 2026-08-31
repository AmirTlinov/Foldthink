import type { WidgetState } from "@foldthink/surface";

type WidgetInitialization = Readonly<{
  protocolVersion: 1;
  kind: "initialize";
  channel: string;
  html: string;
  css: string;
  javascript: string;
  state: WidgetState;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInitialization(value: unknown): WidgetInitialization | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.protocolVersion !== 1 ||
    value.kind !== "initialize" ||
    typeof value.channel !== "string" ||
    value.channel.length === 0 ||
    typeof value.html !== "string" ||
    typeof value.css !== "string" ||
    typeof value.javascript !== "string" ||
    !isRecord(value.state)
  ) return undefined;
  return value as WidgetInitialization;
}

function cloneState(value: WidgetState): WidgetState {
  return JSON.parse(JSON.stringify(value)) as WidgetState;
}

export function startWidgetFrame(): void {
  let initialized = false;
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (initialized || event.source !== window.parent) return;
    const payload = parseInitialization(event.data);
    if (!payload) return;
    initialized = true;

    const send = (kind: string, value: Record<string, unknown> = {}): void => {
      window.parent.postMessage({
        protocolVersion: 1,
        channel: payload.channel,
        kind,
        ...value,
      }, "*");
    };
    const api = Object.freeze({
      state: cloneState(payload.state),
      setState(state: WidgetState): void {
        send("setState", { state: cloneState(state) });
      },
      edit(): void {
        send("edit");
      },
    });

    const style = document.querySelector<HTMLStyleElement>("#foldthink-style");
    const root = document.querySelector<HTMLElement>("#foldthink-root");
    if (!style || !root) return;
    style.textContent = payload.css;
    root.innerHTML = payload.html;
    window.addEventListener("dblclick", () => send("edit"), { capture: true });
    try {
      Function("foldthink", `'use strict';\n${payload.javascript}`)(api);
      send("ready");
    } catch (error) {
      send("error", { message: String(error).slice(0, 1_000) });
    }
  });
  window.parent.postMessage({ protocolVersion: 1, kind: "frameReady" }, "*");
}
