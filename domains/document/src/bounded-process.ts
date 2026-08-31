import { spawn } from "node:child_process";

export type BoundedProcessResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

export type BoundedProcessOptions = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  environment?: Readonly<Record<string, string>>;
  timeoutMilliseconds: number;
  maximumOutputBytes: number;
  signal?: AbortSignal;
}>;

export class ProcessLimitError extends Error {
  override readonly name = "ProcessLimitError";

  constructor(
    readonly limit: "output" | "timeout",
    message: string,
  ) {
    super(message);
  }
}

export async function runBoundedProcess(options: BoundedProcessOptions): Promise<BoundedProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: {
        PATH: process.env.PATH ?? "",
        ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
        ...(options.environment ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let limit: ProcessLimitError | undefined;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      action();
    };
    const abort = (): void => {
      child.kill("SIGKILL");
      finish(() => reject(options.signal?.reason ?? new DOMException("Compilation cancelled.", "AbortError")));
    };
    const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (settled) return;
      if (target === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > options.maximumOutputBytes) {
        limit = new ProcessLimitError("output", "Compiler output exceeded its limit.");
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) => finish(() => {
      if (limit) {
        reject(limit);
      } else if (code === 0) {
        resolve(Object.freeze({ stdout, stderr }));
      } else {
        reject(new Error(`Process ${options.command} exited with ${code ?? signal ?? "unknown"}: ${stderr.slice(-4_000)}`));
      }
    }));
    const timer = setTimeout(() => {
      limit = new ProcessLimitError("timeout", "Compiler execution exceeded its time limit.");
      child.kill("SIGKILL");
    }, options.timeoutMilliseconds);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
