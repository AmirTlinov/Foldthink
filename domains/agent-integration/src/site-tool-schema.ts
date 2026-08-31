import type { SceneChange } from "@foldthink/surface";

export type JsonSchema = Readonly<Record<string, unknown>>;

export type SiteToolExecutionContext = Readonly<{
  signal?: AbortSignal;
}>;

export type SiteToolDefinition = Readonly<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: Readonly<Record<string, boolean>>;
  execute(input: unknown, context?: SiteToolExecutionContext): Promise<unknown>;
}>;

export interface WebMcpModelContext {
  registerTool(tool: SiteToolDefinition): Promise<unknown> | unknown;
  unregisterTool?(name: string): Promise<unknown> | unknown;
}

export type WebMcpDocument = Document & Readonly<{
  modelContext?: WebMcpModelContext;
}>;

export type SurfacePatchInput = Readonly<{
  surfaceId?: string;
  invocationKey?: string;
  changes: readonly SceneChange[];
}>;

const pointSchema = Object.freeze({
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    pressure: { type: "number", minimum: 0, maximum: 1 },
    time: { type: "number" },
  },
  required: ["x", "y", "pressure", "time"],
  additionalProperties: false,
});

const inkSchema = Object.freeze({
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 160 },
    kind: { const: "ink" },
    version: { type: "integer", minimum: 1 },
    points: { type: "array", minItems: 1, maxItems: 10_000, items: pointSchema },
    style: {
      type: "object",
      properties: {
        color: { type: "string" },
        width: { type: "number", exclusiveMinimum: 0, maximum: 200 },
        minimumOpacity: { type: "number", minimum: 0, maximum: 1 },
        maximumOpacity: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["color", "width", "minimumOpacity", "maximumOpacity"],
      additionalProperties: false,
    },
  },
  required: ["id", "kind", "version", "points", "style"],
  additionalProperties: false,
});

const shapeSchema = Object.freeze({
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 160 },
    kind: { const: "shape" },
    version: { type: "integer", minimum: 1 },
    shape: { enum: ["line", "rectangle", "ellipse"] },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    stroke: { type: "string" },
    strokeWidth: { type: "number", exclusiveMinimum: 0, maximum: 200 },
    fill: { type: "string" },
  },
  required: ["id", "kind", "version", "shape", "x", "y", "width", "height", "stroke", "strokeWidth"],
  additionalProperties: false,
});

const markdownSchema = Object.freeze({
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 160 },
    kind: { const: "markdown" },
    version: { type: "integer", minimum: 1 },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number", exclusiveMinimum: 0, maximum: 10_000 },
    source: { type: "string", maxLength: 100_000 },
    color: { type: "string" },
    fontSize: { type: "number", minimum: 6, maximum: 240 },
  },
  required: ["id", "kind", "version", "x", "y", "width", "source", "color", "fontSize"],
  additionalProperties: false,
});

export const inspectSurfaceInputSchema: JsonSchema = Object.freeze({
  type: "object",
  properties: {
    surfaceId: { type: "string", description: "Omit to inspect the surface visible in the page." },
  },
  additionalProperties: false,
});

export const patchSurfaceInputSchema: JsonSchema = Object.freeze({
  type: "object",
  properties: {
    surfaceId: { type: "string", description: "Omit to patch the surface visible in the page." },
    invocationKey: { type: "string", maxLength: 160 },
    changes: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              action: { const: "put" },
              element: { oneOf: [inkSchema, shapeSchema, markdownSchema] },
              expectedVersion: { type: "integer", minimum: 1 },
            },
            required: ["action", "element"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              action: { const: "delete" },
              elementId: { type: "string", minLength: 1, maxLength: 160 },
              expectedVersion: { type: "integer", minimum: 1 },
            },
            required: ["action", "elementId"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["changes"],
  additionalProperties: false,
});

export function parseSurfacePatchInput(input: unknown): SurfacePatchInput {
  if (!input || typeof input !== "object" || !Array.isArray((input as { changes?: unknown }).changes)) {
    throw new TypeError("patch_surface needs a changes array.");
  }
  const candidate = input as {
    surfaceId?: unknown;
    invocationKey?: unknown;
    changes: unknown[];
  };
  if (candidate.changes.length === 0 || candidate.changes.length > 64) {
    throw new TypeError("patch_surface accepts between one and 64 changes.");
  }
  if (candidate.surfaceId !== undefined && typeof candidate.surfaceId !== "string") {
    throw new TypeError("surfaceId must be a string.");
  }
  if (candidate.invocationKey !== undefined && typeof candidate.invocationKey !== "string") {
    throw new TypeError("invocationKey must be a string.");
  }
  for (const change of candidate.changes) {
    if (!change || typeof change !== "object" || !("action" in change)) {
      throw new TypeError("Every surface change needs an action.");
    }
    const action = (change as { action?: unknown }).action;
    if (action === "put") {
      if (!("element" in change) || !(change as { element?: unknown }).element) {
        throw new TypeError("A put change needs an element.");
      }
    } else if (action === "delete") {
      if (
        !("elementId" in change) ||
        typeof (change as { elementId?: unknown }).elementId !== "string" ||
        (change as { elementId: string }).elementId.length === 0
      ) {
        throw new TypeError("A delete change needs an elementId.");
      }
    } else {
      throw new TypeError("A surface change action must be put or delete.");
    }
    if (
      "expectedVersion" in change &&
      (typeof (change as { expectedVersion?: unknown }).expectedVersion !== "number" ||
        !Number.isInteger((change as { expectedVersion: number }).expectedVersion) ||
        (change as { expectedVersion: number }).expectedVersion < 1)
    ) {
      throw new TypeError("expectedVersion must be a positive integer.");
    }
  }
  return Object.freeze({
    ...(candidate.surfaceId === undefined ? {} : { surfaceId: candidate.surfaceId }),
    ...(candidate.invocationKey === undefined ? {} : { invocationKey: candidate.invocationKey }),
    changes: Object.freeze(candidate.changes as SceneChange[]),
  });
}
