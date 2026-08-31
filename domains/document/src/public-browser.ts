export type { BlockEditor, BlockEditorOptions } from "./block-editor.js";
export type {
  DocumentEditRequest,
  DocumentPoint,
  DocumentRenderer,
  DocumentRendererOptions,
  DocumentViewport,
  EditableDocumentBlock,
} from "./document-renderer.js";
export { DocumentError } from "./document-protocol.js";
export type { LatexCompilation, LatexCompilationPage } from "./document-protocol.js";
export { startWidgetFrame } from "./widget-frame-runtime.js";

export function loadBlockEditor(): Promise<typeof import("./block-editor-entry.js")> {
  return import("./block-editor-entry.js");
}

export function loadDocumentRenderer(): Promise<typeof import("./document-renderer-entry.js")> {
  return import("./document-renderer-entry.js");
}
