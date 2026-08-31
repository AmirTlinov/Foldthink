import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentError } from "./document-protocol.js";
import { ProcessLimitError, runBoundedProcess } from "./bounded-process.js";

export type CompiledLatexPage = Readonly<{
  bytes: Uint8Array;
  width: number;
  height: number;
}>;

export interface LatexProcessCompiler {
  readonly version: string;
  compile(source: string, signal?: AbortSignal): Promise<readonly CompiledLatexPage[]>;
}

export type TectonicProcessCompilerOptions = Readonly<{
  tectonicBinary?: string;
  pdfInfoBinary?: string;
  pdfToCairoBinary?: string;
  bundlePath?: string;
  version?: string;
  timeoutMilliseconds?: number;
}>;

const maximumPdfBytes = 10_000_000;
const maximumSvgBytes = 5_000_000;
const maximumPages = 24;

function pageGeometry(svg: string): Readonly<{ width: number; height: number }> {
  const match = /viewBox="0 0 ([0-9]+(?:\.[0-9]+)?) ([0-9]+(?:\.[0-9]+)?)"/u.exec(svg);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new DocumentError("compile_failed", "The compiled page has no bounded geometry.");
  }
  return Object.freeze({ width, height });
}

export class TectonicProcessCompiler implements LatexProcessCompiler {
  readonly version: string;
  readonly #tectonicBinary: string;
  readonly #pdfInfoBinary: string;
  readonly #pdfToCairoBinary: string;
  readonly #bundlePath: string | undefined;
  readonly #timeoutMilliseconds: number;

  constructor(options: TectonicProcessCompilerOptions = {}) {
    this.version = options.version ?? "tectonic-0.16.9+pdftocairo";
    this.#tectonicBinary = options.tectonicBinary ?? "tectonic";
    this.#pdfInfoBinary = options.pdfInfoBinary ?? "pdfinfo";
    this.#pdfToCairoBinary = options.pdfToCairoBinary ?? "pdftocairo";
    this.#bundlePath = options.bundlePath;
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 12_000;
  }

  async compile(source: string, signal?: AbortSignal): Promise<readonly CompiledLatexPage[]> {
    const root = await mkdtemp(join(tmpdir(), "foldthink-latex-"));
    const output = join(root, "output");
    const input = join(root, "main.tex");
    const pdf = join(output, "main.pdf");
    try {
      await mkdir(output, { mode: 0o700 });
      await writeFile(input, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await this.#run(this.#tectonicBinary, [
        "-X",
        "compile",
        "--untrusted",
        "--only-cached",
        "--outfmt",
        "pdf",
        "--outdir",
        output,
        ...(this.#bundlePath ? ["--bundle", this.#bundlePath] : []),
        input,
      ], root, signal);
      const pdfBytes = await readFile(pdf);
      if (pdfBytes.byteLength <= 0 || pdfBytes.byteLength > maximumPdfBytes) {
        throw new DocumentError("resource_limit", "The compiled PDF exceeded its size limit.");
      }
      const information = await this.#run(this.#pdfInfoBinary, [pdf], root, signal);
      const pages = Number(/^Pages:\s+([0-9]+)$/mu.exec(information.stdout)?.[1]);
      if (!Number.isInteger(pages) || pages <= 0 || pages > maximumPages) {
        throw new DocumentError("resource_limit", "A LaTeX document must contain between one and 24 pages.");
      }
      const result: CompiledLatexPage[] = [];
      let totalBytes = 0;
      for (let page = 1; page <= pages; page += 1) {
        const destination = join(output, `page-${page}.svg`);
        await this.#run(this.#pdfToCairoBinary, [
          "-svg",
          "-f",
          String(page),
          "-l",
          String(page),
          pdf,
          destination,
        ], root, signal);
        const bytes = await readFile(destination);
        totalBytes += bytes.byteLength;
        if (bytes.byteLength <= 0 || bytes.byteLength > maximumSvgBytes || totalBytes > 20_000_000) {
          throw new DocumentError("resource_limit", "Compiled page output exceeded its size limit.");
        }
        const geometry = pageGeometry(bytes.toString("utf8", 0, Math.min(bytes.byteLength, 2_048)));
        result.push(Object.freeze({ bytes: new Uint8Array(bytes), ...geometry }));
      }
      return Object.freeze(result);
    } catch (error) {
      if (error instanceof DocumentError) throw error;
      if (error instanceof ProcessLimitError) {
        throw new DocumentError("resource_limit", error.message);
      }
      if (signal?.aborted) throw signal.reason;
      throw new DocumentError(
        "compile_failed",
        error instanceof Error ? error.message.slice(0, 4_000) : "LaTeX compilation failed.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  #run(
    command: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<Readonly<{ stdout: string; stderr: string }>> {
    return runBoundedProcess({
      command,
      args,
      cwd,
      environment: { TECTONIC_UNTRUSTED_MODE: "1" },
      timeoutMilliseconds: this.#timeoutMilliseconds,
      maximumOutputBytes: 64_000,
      ...(signal ? { signal } : {}),
    });
  }
}
