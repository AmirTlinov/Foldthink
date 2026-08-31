import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type RequestObservation = Readonly<{
  requestId: string;
  route: string;
  finish(status: number, errorClass?: string): void;
}>;

export type ServiceMetrics = Readonly<{
  requests: number;
  failures: number;
  requestLatencyMilliseconds: Readonly<{ p50: number; p95: number; p99: number }>;
  commitAcknowledgementMilliseconds: Readonly<{ p50: number; p95: number; p99: number }>;
}>;

type LogRecord = Readonly<Record<string, string | number>>;

const workspaceRoute = /^\/api\/workspaces\/[^/]+$/u;
const workspaceChildRoute = /^\/api\/workspaces\/[^/]+\/(state|operations|join-capabilities|assets|latex\/compile)$/u;
const assetRoute = /^\/api\/workspaces\/[^/]+\/assets\/[^/]+(?:\/(content|finalize))?$/u;

export function routeTemplate(pathname: string): string {
  if (pathname === "/health" || pathname === "/ready" || pathname === "/internal/metrics") return pathname;
  if (pathname === "/api/session/bootstrap" || pathname === "/api/session/join") return pathname;
  if (workspaceRoute.test(pathname)) return "/api/workspaces/:workspaceId";
  const child = workspaceChildRoute.exec(pathname)?.[1];
  if (child) return `/api/workspaces/:workspaceId/${child}`;
  const asset = assetRoute.exec(pathname);
  if (asset) return `/api/workspaces/:workspaceId/assets/:assetId${asset[1] ? `/${asset[1]}` : ""}`;
  if (pathname === "/sync") return "/sync";
  return "unmatched";
}

function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return 0;
  const ordered = [...samples].sort((left, right) => left - right);
  return Math.round((ordered[Math.ceil(fraction * ordered.length) - 1] ?? 0) * 100) / 100;
}

function validRequestId(candidate: string | undefined): string | undefined {
  return candidate && /^[A-Za-z0-9_-]{8,80}$/u.test(candidate) ? candidate : undefined;
}

export class ServiceObserver {
  readonly #revision: string;
  readonly #write: (record: LogRecord) => void;
  readonly #now: () => number;
  readonly #latencies: number[] = [];
  readonly #commitLatencies: number[] = [];
  #requests = 0;
  #failures = 0;

  constructor(
    revision: string,
    write: (record: LogRecord) => void = (record) => process.stdout.write(`${JSON.stringify(record)}\n`),
    now: () => number = performance.now.bind(performance),
  ) {
    this.#revision = revision;
    this.#write = write;
    this.#now = now;
  }

  begin(request: IncomingMessage, pathname: string): RequestObservation {
    const startedAt = this.#now();
    const route = routeTemplate(pathname);
    const requestId = validRequestId(
      Array.isArray(request.headers["x-request-id"])
        ? request.headers["x-request-id"][0]
        : request.headers["x-request-id"],
    ) ?? randomUUID();
    let finished = false;
    return Object.freeze({
      requestId,
      route,
      finish: (status, errorClass): void => {
        if (finished) return;
        finished = true;
        const durationMilliseconds = Math.max(0, this.#now() - startedAt);
        this.#requests += 1;
        if (status >= 500) this.#failures += 1;
        this.#remember(this.#latencies, durationMilliseconds);
        if (route === "/api/workspaces/:workspaceId/operations" && request.method === "POST" && status < 400) {
          this.#remember(this.#commitLatencies, durationMilliseconds);
        }
        if (route === "/health") return;
        this.#write(Object.freeze({
          event: "request.completed",
          requestId,
          method: request.method ?? "UNKNOWN",
          route,
          status,
          durationMilliseconds: Math.round(durationMilliseconds * 100) / 100,
          revision: this.#revision,
          ...(errorClass ? { errorClass } : {}),
        }));
      },
    });
  }

  metrics(): ServiceMetrics {
    return Object.freeze({
      requests: this.#requests,
      failures: this.#failures,
      requestLatencyMilliseconds: Object.freeze({
        p50: percentile(this.#latencies, 0.5),
        p95: percentile(this.#latencies, 0.95),
        p99: percentile(this.#latencies, 0.99),
      }),
      commitAcknowledgementMilliseconds: Object.freeze({
        p50: percentile(this.#commitLatencies, 0.5),
        p95: percentile(this.#commitLatencies, 0.95),
        p99: percentile(this.#commitLatencies, 0.99),
      }),
    });
  }

  #remember(target: number[], value: number): void {
    target.push(value);
    if (target.length > 2_048) target.splice(0, target.length - 2_048);
  }
}
