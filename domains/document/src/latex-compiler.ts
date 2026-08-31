import { createHash } from "node:crypto";
import type { AssetActor, AssetRegistry } from "@foldthink/asset/server";
import {
  DocumentError,
  type LatexCompilation,
  type LatexCompilationPage,
} from "./document-protocol.js";
import type { LatexProcessCompiler } from "./tectonic-process-compiler.js";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseManifest(value: Uint8Array): LatexCompilation | undefined {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(value)) as Partial<LatexCompilation>;
    if (
      typeof parsed.artifactKey !== "string" ||
      typeof parsed.sourceSha256 !== "string" ||
      typeof parsed.compilerVersion !== "string" ||
      !Array.isArray(parsed.pages) ||
      parsed.pages.length === 0 ||
      parsed.pages.some((page) =>
        !page ||
        typeof page.assetId !== "string" ||
        !Number.isFinite(page.width) ||
        !Number.isFinite(page.height))
    ) return undefined;
    return Object.freeze({
      artifactKey: parsed.artifactKey,
      sourceSha256: parsed.sourceSha256,
      compilerVersion: parsed.compilerVersion,
      pages: Object.freeze(parsed.pages.map((page) => Object.freeze({ ...page }))) as readonly LatexCompilationPage[],
    });
  } catch {
    return undefined;
  }
}

export class LatexCompiler {
  readonly #assets: AssetRegistry;
  readonly #process: LatexProcessCompiler;

  constructor(assets: AssetRegistry, processCompiler: LatexProcessCompiler) {
    this.#assets = assets;
    this.#process = processCompiler;
  }

  async compile(actor: AssetActor, source: string, signal?: AbortSignal): Promise<LatexCompilation> {
    if (source.length === 0 || source.length > 500_000) {
      throw new DocumentError("invalid", "LaTeX source must contain between one and 500,000 characters.");
    }
    const sourceSha256 = sha256(source);
    const artifactKey = sha256(JSON.stringify({
      sourceSha256,
      compilerVersion: this.#process.version,
      format: "svg-pages-v1",
    }));
    const manifestKey = `latex:${artifactKey}:manifest`;
    const existing = await this.#assets.readyDerived(actor, manifestKey);
    if (existing) {
      const manifest = parseManifest((await this.#assets.read(actor, existing.assetId)).bytes);
      if (manifest) {
        await this.#assets.assertReady(actor, manifest.pages.map((page) => page.assetId));
        return manifest;
      }
    }
    const pages = await this.#process.compile(source, signal);
    const published: LatexCompilationPage[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      if (!page) continue;
      const asset = await this.#assets.publishDerived(actor, {
        derivationKey: `latex:${artifactKey}:page:${index + 1}`,
        mimeType: "image/svg+xml",
        bytes: page.bytes,
        producer: this.#process.version,
        metadata: { page: index + 1, width: page.width, height: page.height },
      });
      published.push(Object.freeze({ assetId: asset.assetId, width: page.width, height: page.height }));
    }
    if (published.length === 0) throw new DocumentError("compile_failed", "LaTeX produced no visible pages.");
    const result: LatexCompilation = Object.freeze({
      artifactKey,
      sourceSha256,
      compilerVersion: this.#process.version,
      pages: Object.freeze(published),
    });
    await this.#assets.publishDerived(actor, {
      derivationKey: manifestKey,
      mimeType: "application/vnd.foldthink.latex+json",
      bytes: new TextEncoder().encode(JSON.stringify(result)),
      producer: this.#process.version,
      metadata: { pageCount: result.pages.length },
    });
    return result;
  }
}
