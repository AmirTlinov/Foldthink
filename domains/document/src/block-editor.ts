import { AssetClient } from "@foldthink/asset/browser";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  type AssetBlock,
  type LatexBlock,
  type MarkdownBlock,
  type WidgetBlock,
} from "@foldthink/surface";
import type { WorkspaceRuntime } from "@foldthink/workspace";
import { DocumentError } from "./document-protocol.js";
import type { DocumentEditRequest, DocumentPoint, EditableDocumentBlock } from "./document-renderer.js";

type BlockKind = EditableDocumentBlock["kind"];
type WidgetSource = "html" | "css" | "javascript";

export type BlockEditorOptions = Readonly<{
  runtime: WorkspaceRuntime;
  assets: AssetClient;
  onStatus?(status: string): void;
}>;

type Draft = {
  kind: BlockKind;
  markdown: string;
  latex: string;
  latexMode: LatexBlock["mode"];
  widget: Record<WidgetSource, string>;
  widgetSource: WidgetSource;
  assetFile?: File;
  assetAlt: string;
};

const editorTheme = EditorView.theme({
  "&": { height: "100%", color: "#171714", backgroundColor: "transparent" },
  ".cm-content": { padding: "22px 24px", caretColor: "#171714", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  ".cm-scroller": { overflow: "auto", fontSize: "15px", lineHeight: "1.65" },
  ".cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "rgba(94, 123, 141, 0.18) !important" },
});

function sourceExtension(kind: BlockKind, widgetSource: WidgetSource): Extension {
  if (kind === "markdown") return markdown();
  if (kind === "latex") return StreamLanguage.define(stex);
  if (kind === "widget") {
    if (widgetSource === "html") return html();
    if (widgetSource === "css") return css();
    return javascript({ typescript: false });
  }
  return [];
}

function initialDraft(block?: EditableDocumentBlock): Draft {
  return {
    kind: block?.kind ?? "markdown",
    markdown: block?.kind === "markdown" ? block.source : "",
    latex: block?.kind === "latex" ? block.source : "",
    latexMode: block?.kind === "latex" ? block.mode : "math",
    widget: {
      html: block?.kind === "widget" ? block.html : "<button id=\"action\">Think</button><output id=\"result\"></output>",
      css: block?.kind === "widget" ? block.css : "button { font: inherit; padding: .7em 1em; border-radius: 999px; }",
      javascript: block?.kind === "widget" ? block.javascript : "document.querySelector('#action').onclick = () => {\n  const count = (foldthink.state.count ?? 0) + 1\n  foldthink.setState({ count })\n  document.querySelector('#result').textContent = ` ${count}`\n}",
    },
    widgetSource: "html",
    assetAlt: block?.kind === "asset" ? block.alt : "",
  };
}

function clampFrame(point: DocumentPoint, width: number, height: number): Readonly<{ x: number; y: number; width: number; height: number }> {
  return Object.freeze({
    x: Math.max(40, Math.min(1_000 - width - 40, point.x - 24)),
    y: Math.max(40, Math.min(1_400 - height - 40, point.y - 24)),
    width,
    height,
  });
}

export class BlockEditor {
  readonly #options: BlockEditorOptions;
  #request: DocumentEditRequest | undefined;
  #backdrop: HTMLDivElement | undefined;
  #editorHost: HTMLDivElement | undefined;
  #editor: EditorView | undefined;
  #draft: Draft | undefined;
  #error: HTMLOutputElement | undefined;
  #sourceTabs: HTMLDivElement | undefined;
  #saving = false;

  constructor(options: BlockEditorOptions) {
    this.#options = options;
  }

  open(request: DocumentEditRequest): void {
    this.close();
    this.#request = request;
    this.#draft = initialDraft(request.block);
    const backdrop = document.createElement("div");
    backdrop.className = "foldthink-editor-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", request.block ? "Edit document block" : "Create document block");
    const sheet = document.createElement("section");
    sheet.className = "foldthink-editor-sheet";
    const header = document.createElement("header");
    header.className = "foldthink-editor-header";
    const kindTabs = document.createElement("div");
    kindTabs.className = "foldthink-editor-tabs";
    for (const [kind, label] of [
      ["markdown", "Text"],
      ["latex", "LaTeX"],
      ["widget", "Interactive"],
      ["asset", "Image"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.kind = kind;
      button.dataset.selected = String(this.#draft.kind === kind);
      button.disabled = Boolean(request.block && request.block.kind !== kind);
      button.addEventListener("click", () => this.#selectKind(kind, kindTabs));
      kindTabs.append(button);
    }
    const actions = document.createElement("div");
    actions.className = "foldthink-editor-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());
    const save = document.createElement("button");
    save.type = "button";
    save.className = "foldthink-editor-save";
    save.textContent = "Save";
    save.addEventListener("click", () => void this.save());
    actions.append(cancel, save);
    header.append(kindTabs, actions);
    const secondary = document.createElement("div");
    secondary.className = "foldthink-editor-secondary";
    this.#sourceTabs = secondary;
    const body = document.createElement("div");
    body.className = "foldthink-editor-body";
    const editorHost = document.createElement("div");
    editorHost.className = "foldthink-code-editor";
    body.append(editorHost);
    const error = document.createElement("output");
    error.className = "foldthink-editor-error";
    error.setAttribute("aria-live", "polite");
    sheet.append(header, secondary, body, error);
    backdrop.append(sheet);
    document.body.append(backdrop);
    this.#backdrop = backdrop;
    this.#editorHost = editorHost;
    this.#error = error;
    this.#renderSecondary();
    this.#openSourceEditor();
  }

  close(): void {
    this.#saveActiveSource();
    this.#editor?.destroy();
    this.#editor = undefined;
    this.#backdrop?.remove();
    this.#backdrop = undefined;
    this.#editorHost = undefined;
    this.#request = undefined;
    this.#draft = undefined;
    this.#error = undefined;
    this.#sourceTabs = undefined;
    this.#saving = false;
  }

  async save(): Promise<void> {
    if (this.#saving) return;
    const request = this.#request;
    const draft = this.#draft;
    if (!request || !draft) return;
    this.#saveActiveSource();
    this.#saving = true;
    this.#setError("");
    try {
      const current = request.block
        ? this.#options.runtime.inspect(request.surfaceId).elements.find((element) => element.id === request.block?.id)
        : undefined;
      if (request.block && (!current || current.version !== request.block.version || current.kind !== request.block.kind)) {
        throw new DocumentError("conflict", "This block changed elsewhere. Close it and open the latest source.");
      }
      const element = await this.#element(request, draft);
      await this.#options.runtime.dispatch({
        kind: "patchSurface",
        surfaceId: request.surfaceId,
        changes: [{
          action: "put",
          ...(request.block ? { expectedVersion: request.block.version } : {}),
          element,
        }],
      });
      this.#options.onStatus?.("Document source saved on this device");
      this.close();
    } catch (error) {
      this.#setError(error instanceof Error ? error.message : "This document block could not be saved.");
      this.#saving = false;
    }
  }

  destroy(): void {
    this.close();
  }

  #selectKind(kind: BlockKind, tabs: HTMLElement): void {
    const draft = this.#draft;
    if (!draft || draft.kind === kind) return;
    this.#saveActiveSource();
    draft.kind = kind;
    for (const button of tabs.querySelectorAll("button")) {
      button.dataset.selected = String(button.dataset.kind === kind);
    }
    this.#renderSecondary();
    this.#openSourceEditor();
  }

  #renderSecondary(): void {
    const container = this.#sourceTabs;
    const draft = this.#draft;
    if (!container || !draft) return;
    container.replaceChildren();
    if (draft.kind === "latex") {
      const tabs = document.createElement("div");
      tabs.className = "foldthink-editor-tabs compact";
      for (const [mode, label] of [["math", "Math"], ["document", "Full document"]] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.selected = String(draft.latexMode === mode);
        button.addEventListener("click", () => {
          draft.latexMode = mode;
          for (const peer of tabs.querySelectorAll("button")) peer.dataset.selected = String(peer === button);
        });
        tabs.append(button);
      }
      container.append(tabs);
    } else if (draft.kind === "widget") {
      const tabs = document.createElement("div");
      tabs.className = "foldthink-editor-tabs compact";
      for (const [source, label] of [["html", "HTML"], ["css", "CSS"], ["javascript", "JavaScript"]] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.selected = String(draft.widgetSource === source);
        button.addEventListener("click", () => {
          this.#saveActiveSource();
          draft.widgetSource = source;
          for (const peer of tabs.querySelectorAll("button")) peer.dataset.selected = String(peer === button);
          this.#openSourceEditor();
        });
        tabs.append(button);
      }
      container.append(tabs);
    } else if (draft.kind === "asset") {
      const form = document.createElement("div");
      form.className = "foldthink-asset-form";
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) draft.assetFile = file;
        else delete draft.assetFile;
      });
      const alt = document.createElement("input");
      alt.type = "text";
      alt.placeholder = "Describe the image";
      alt.value = draft.assetAlt;
      alt.addEventListener("input", () => {
        draft.assetAlt = alt.value;
      });
      form.append(input, alt);
      container.append(form);
    }
  }

  #openSourceEditor(): void {
    this.#editor?.destroy();
    this.#editor = undefined;
    const host = this.#editorHost;
    const draft = this.#draft;
    if (!host || !draft) return;
    host.replaceChildren();
    host.hidden = draft.kind === "asset";
    if (draft.kind === "asset") return;
    const source = draft.kind === "markdown"
      ? draft.markdown
      : draft.kind === "latex"
        ? draft.latex
        : draft.widget[draft.widgetSource];
    this.#editor = new EditorView({
      state: EditorState.create({
        doc: source,
        extensions: [
          history(),
          keymap.of([
            { key: "Mod-Enter", run: () => { void this.save(); return true; } },
            { key: "Escape", run: () => { this.close(); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorState.tabSize.of(2),
          EditorView.lineWrapping,
          editorTheme,
          sourceExtension(draft.kind, draft.widgetSource),
        ],
      }),
      parent: host,
    });
    this.#editor.focus();
  }

  #saveActiveSource(): void {
    const editor = this.#editor;
    const draft = this.#draft;
    if (!editor || !draft || draft.kind === "asset") return;
    const source = editor.state.doc.toString();
    if (draft.kind === "markdown") draft.markdown = source;
    else if (draft.kind === "latex") draft.latex = source;
    else draft.widget[draft.widgetSource] = source;
  }

  async #element(request: DocumentEditRequest, draft: Draft): Promise<EditableDocumentBlock> {
    const existing = request.block;
    const id = existing?.id ?? crypto.randomUUID();
    if (draft.kind === "markdown") {
      const frame = existing?.kind === "markdown"
        ? existing
        : clampFrame(request.point, 680, 300);
      const block: MarkdownBlock = {
        id,
        kind: "markdown",
        version: existing?.version ?? 1,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height ?? 300,
        source: draft.markdown,
        color: existing?.kind === "markdown" ? existing.color : "#171714",
        fontSize: existing?.kind === "markdown" ? existing.fontSize : 30,
      };
      return Object.freeze(block);
    }
    if (draft.kind === "latex") {
      if (!draft.latex.trim()) throw new DocumentError("invalid", "LaTeX source is empty.");
      const frame = existing?.kind === "latex"
        ? existing
        : clampFrame(request.point, draft.latexMode === "document" ? 820 : 680, draft.latexMode === "document" ? 1_040 : 220);
      const block: LatexBlock = {
        id,
        kind: "latex",
        version: existing?.version ?? 1,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        source: draft.latex,
        mode: draft.latexMode,
        color: existing?.kind === "latex" ? existing.color : "#171714",
        fontSize: existing?.kind === "latex" ? existing.fontSize : 30,
      };
      return Object.freeze(block);
    }
    if (draft.kind === "widget") {
      const frame = existing?.kind === "widget" ? existing : clampFrame(request.point, 680, 360);
      const block: WidgetBlock = {
        id,
        kind: "widget",
        version: existing?.version ?? 1,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        html: draft.widget.html,
        css: draft.widget.css,
        javascript: draft.widget.javascript,
        state: existing?.kind === "widget" ? existing.state : {},
      };
      return Object.freeze(block);
    }
    const ready = draft.assetFile
      ? await this.#options.assets.upload(draft.assetFile)
      : existing?.kind === "asset"
        ? { assetId: existing.assetId }
        : undefined;
    if (!ready) throw new DocumentError("invalid", "Choose an image before saving.");
    const frame = existing?.kind === "asset" ? existing : clampFrame(request.point, 640, 440);
    const block: AssetBlock = {
      id,
      kind: "asset",
      version: existing?.version ?? 1,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      assetId: ready.assetId,
      alt: draft.assetAlt,
      fit: existing?.kind === "asset" ? existing.fit : "contain",
    };
    return Object.freeze(block);
  }

  #setError(message: string): void {
    if (this.#error) this.#error.textContent = message;
  }
}
