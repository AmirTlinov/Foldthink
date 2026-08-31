export type ScenePoint = Readonly<{
  x: number;
  y: number;
  pressure: number;
  time: number;
}>;

export type InkStyle = Readonly<{
  color: string;
  width: number;
  minimumOpacity: number;
  maximumOpacity: number;
}>;

export type InkStroke = Readonly<{
  id: string;
  kind: "ink";
  version: number;
  points: readonly ScenePoint[];
  style: InkStyle;
}>;

export type EraserStyle = Readonly<{
  minimumWidth: number;
  maximumWidth: number;
}>;

export type EraseMask = Readonly<{
  id: string;
  kind: "erase";
  version: number;
  points: readonly ScenePoint[];
  style: EraserStyle;
  affectedStrokeIds: readonly string[];
}>;

export type ShapeElement = Readonly<{
  id: string;
  kind: "shape";
  version: number;
  shape: "line" | "rectangle" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  strokeWidth: number;
  fill?: string;
}>;

export type MarkdownBlock = Readonly<{
  id: string;
  kind: "markdown";
  version: number;
  x: number;
  y: number;
  width: number;
  source: string;
  color: string;
  fontSize: number;
}>;

export type WorkspaceItem = Readonly<{
  id: string;
  kind: "item";
  version: number;
  itemKind: "notebook" | "document";
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  title?: string;
  coverSurfaceId: string;
  pageSurfaceIds: readonly string[];
  activePageIndex: number;
  stackId?: string;
  stackOrder: number;
}>;

export type SceneElement = InkStroke | EraseMask | ShapeElement | MarkdownBlock | WorkspaceItem;

export type SceneChange =
  | Readonly<{
      action: "put";
      element: SceneElement;
      expectedVersion?: number;
    }>
  | Readonly<{
      action: "delete";
      elementId: string;
      expectedVersion?: number;
    }>;

export class SceneValidationError extends Error {
  override readonly name = "SceneValidationError";
}

export class SceneConflictError extends Error {
  override readonly name = "SceneConflictError";
}

const finite = (value: number): boolean => Number.isFinite(value);
const unit = (value: number): boolean => finite(value) && value >= 0 && value <= 1;

export function validateSceneElement(element: SceneElement): void {
  if (!element.id || element.id.length > 160 || !Number.isInteger(element.version) || element.version < 1) {
    throw new SceneValidationError("An element needs a stable ID and a positive integer version.");
  }

  switch (element.kind) {
    case "ink": {
      if (element.points.length === 0 || element.points.length > 100_000) {
        throw new SceneValidationError("An ink stroke needs a bounded point sequence.");
      }
      if (
        !finite(element.style.width) ||
        element.style.width <= 0 ||
        element.style.width > 200 ||
        !unit(element.style.minimumOpacity) ||
        !unit(element.style.maximumOpacity) ||
        element.style.minimumOpacity > element.style.maximumOpacity
      ) {
        throw new SceneValidationError("Ink style is outside its supported range.");
      }
      for (const point of element.points) {
        if (!finite(point.x) || !finite(point.y) || !finite(point.time) || !unit(point.pressure)) {
          throw new SceneValidationError("Ink contains an invalid point.");
        }
      }
      return;
    }
    case "erase": {
      if (
        element.points.length === 0 ||
        element.points.length > 100_000 ||
        !finite(element.style.minimumWidth) ||
        !finite(element.style.maximumWidth) ||
        element.style.minimumWidth <= 0 ||
        element.style.maximumWidth > 400 ||
        element.style.minimumWidth > element.style.maximumWidth ||
        element.affectedStrokeIds.length === 0 ||
        element.affectedStrokeIds.length > 10_000 ||
        new Set(element.affectedStrokeIds).size !== element.affectedStrokeIds.length ||
        element.affectedStrokeIds.some((strokeId) => strokeId.length === 0 || strokeId.length > 160)
      ) {
        throw new SceneValidationError("An erase mask needs bounded geometry and affected strokes.");
      }
      for (const point of element.points) {
        if (!finite(point.x) || !finite(point.y) || !finite(point.time) || !unit(point.pressure)) {
          throw new SceneValidationError("An erase mask contains an invalid point.");
        }
      }
      return;
    }
    case "shape":
      if (
        !finite(element.x) ||
        !finite(element.y) ||
        !finite(element.width) ||
        !finite(element.height) ||
        !finite(element.strokeWidth) ||
        element.strokeWidth <= 0 ||
        element.strokeWidth > 200
      ) {
        throw new SceneValidationError("Shape geometry is outside its supported range.");
      }
      return;
    case "markdown":
      if (
        !finite(element.x) ||
        !finite(element.y) ||
        !finite(element.width) ||
        element.width <= 0 ||
        element.width > 10_000 ||
        !finite(element.fontSize) ||
        element.fontSize < 6 ||
        element.fontSize > 240 ||
        element.source.length > 100_000
      ) {
        throw new SceneValidationError("Markdown block is outside its supported range.");
      }
      return;
    case "item":
      if (
        !finite(element.x) ||
        !finite(element.y) ||
        !finite(element.width) ||
        !finite(element.height) ||
        element.width < 120 ||
        element.width > 20_000 ||
        element.height < 120 ||
        element.height > 20_000 ||
        !Number.isInteger(element.z) ||
        !Number.isInteger(element.stackOrder) ||
        element.stackOrder < 0 ||
        !Number.isInteger(element.activePageIndex) ||
        element.pageSurfaceIds.length === 0 ||
        element.pageSurfaceIds.length > 1_000 ||
        element.activePageIndex < 0 ||
        element.activePageIndex >= element.pageSurfaceIds.length ||
        element.coverSurfaceId.length === 0 ||
        element.coverSurfaceId.length > 160 ||
        element.pageSurfaceIds.some((surfaceId) => surfaceId.length === 0 || surfaceId.length > 160) ||
        new Set(element.pageSurfaceIds).size !== element.pageSurfaceIds.length ||
        element.pageSurfaceIds.includes(element.coverSurfaceId) ||
        (element.title?.length ?? 0) > 240 ||
        (element.stackId !== undefined && (element.stackId.length === 0 || element.stackId.length > 160))
      ) {
        throw new SceneValidationError("Workspace item geometry or surface references are outside their supported range.");
      }
  }
}
