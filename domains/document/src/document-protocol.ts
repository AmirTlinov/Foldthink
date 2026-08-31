export type LatexCompilationPage = Readonly<{
  assetId: string;
  width: number;
  height: number;
}>;

export type LatexCompilation = Readonly<{
  artifactKey: string;
  sourceSha256: string;
  compilerVersion: string;
  pages: readonly LatexCompilationPage[];
}>;

export type CompileLatexRequest = Readonly<{
  source: string;
}>;

export class DocumentError extends Error {
  override readonly name = "DocumentError";

  constructor(
    readonly code:
      | "invalid"
      | "compile_failed"
      | "resource_limit"
      | "not_available"
      | "conflict",
    message: string,
  ) {
    super(message);
  }
}
