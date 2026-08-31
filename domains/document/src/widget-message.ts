import type { WidgetState } from "@foldthink/surface";

export type WidgetToHostMessage =
  | Readonly<{
      protocolVersion: 1;
      channel: string;
      kind: "ready";
    }>
  | Readonly<{
      protocolVersion: 1;
      channel: string;
      kind: "setState";
      state: WidgetState;
    }>
  | Readonly<{
      protocolVersion: 1;
      channel: string;
      kind: "edit";
    }>
  | Readonly<{
      protocolVersion: 1;
      channel: string;
      kind: "error";
      message: string;
    }>;

export function parseWidgetMessage(value: unknown, channel: string): WidgetToHostMessage | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("protocolVersion" in value) ||
    value.protocolVersion !== 1 ||
    !("channel" in value) ||
    value.channel !== channel ||
    !("kind" in value)
  ) return undefined;
  if (value.kind === "ready" || value.kind === "edit") {
    return Object.freeze({ protocolVersion: 1, channel, kind: value.kind });
  }
  if (value.kind === "error" && "message" in value && typeof value.message === "string") {
    return Object.freeze({
      protocolVersion: 1,
      channel,
      kind: "error",
      message: value.message.slice(0, 1_000),
    });
  }
  if (value.kind === "setState" && "state" in value) {
    return Object.freeze({
      protocolVersion: 1,
      channel,
      kind: "setState",
      state: value.state as WidgetState,
    });
  }
  return undefined;
}
