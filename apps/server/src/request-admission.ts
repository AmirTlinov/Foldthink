import { createHash } from "node:crypto";
import { HttpBoundaryError } from "./http-boundary.js";

export type AdmissionClass = "ordinary" | "write" | "upload" | "compile";

export type AdmissionLease = Readonly<{
  release(): void;
}>;

type Bucket = {
  tokens: number;
  updatedAt: number;
  lastSeenAt: number;
};

export type RequestAdmissionOptions = Readonly<{
  capacity?: number;
  refillPerSecond?: number;
  maximumConcurrent?: number;
  maximumConcurrentCompiles?: number;
  maximumBuckets?: number;
  networkCapacity?: number;
  networkRefillPerSecond?: number;
  now?: () => number;
}>;

const admissionCost: Readonly<Record<AdmissionClass, number>> = Object.freeze({
  ordinary: 1,
  write: 2,
  upload: 8,
  compile: 20,
});

export class RequestAdmission {
  readonly #capacity: number;
  readonly #refillPerMillisecond: number;
  readonly #maximumConcurrent: number;
  readonly #maximumConcurrentCompiles: number;
  readonly #maximumBuckets: number;
  readonly #networkCapacity: number;
  readonly #networkRefillPerMillisecond: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, Bucket>();
  readonly #networkBuckets = new Map<string, Bucket>();
  #active = 0;
  #activeCompiles = 0;

  constructor(options: RequestAdmissionOptions = {}) {
    this.#capacity = options.capacity ?? 120;
    this.#refillPerMillisecond = (options.refillPerSecond ?? 2) / 1_000;
    this.#maximumConcurrent = options.maximumConcurrent ?? 128;
    this.#maximumConcurrentCompiles = options.maximumConcurrentCompiles ?? 2;
    this.#maximumBuckets = options.maximumBuckets ?? 10_000;
    this.#networkCapacity = options.networkCapacity ?? 2_000;
    this.#networkRefillPerMillisecond = (options.networkRefillPerSecond ?? 40) / 1_000;
    this.#now = options.now ?? Date.now;
  }

  acquire(clientKey: string, requestClass: AdmissionClass, networkKey = clientKey): AdmissionLease {
    if (this.#active >= this.#maximumConcurrent) {
      throw new HttpBoundaryError(503, "Foldthink is at its bounded request capacity.");
    }
    if (requestClass === "compile" && this.#activeCompiles >= this.#maximumConcurrentCompiles) {
      throw new HttpBoundaryError(429, "Document compilation capacity is currently in use.");
    }

    const now = this.#now();
    const cost = admissionCost[requestClass];
    const clientBucket = this.#bucket(this.#buckets, clientKey, now, this.#capacity);
    const networkBucket = this.#bucket(this.#networkBuckets, networkKey, now, this.#networkCapacity);
    this.#refill(clientBucket, now, this.#capacity, this.#refillPerMillisecond);
    this.#refill(networkBucket, now, this.#networkCapacity, this.#networkRefillPerMillisecond);
    if (clientBucket.tokens < cost || networkBucket.tokens < cost) {
      throw new HttpBoundaryError(429, "Foldthink is receiving requests faster than it can safely accept them.");
    }
    clientBucket.tokens -= cost;
    networkBucket.tokens -= cost;
    this.#active += 1;
    if (requestClass === "compile") this.#activeCompiles += 1;

    let released = false;
    return Object.freeze({
      release: (): void => {
        if (released) return;
        released = true;
        this.#active -= 1;
        if (requestClass === "compile") this.#activeCompiles -= 1;
      },
    });
  }

  #refill(bucket: Bucket, now: number, capacity: number, refillPerMillisecond: number): void {
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + Math.max(0, now - bucket.updatedAt) * refillPerMillisecond,
    );
    bucket.updatedAt = now;
    bucket.lastSeenAt = now;
  }

  #bucket(buckets: Map<string, Bucket>, clientKey: string, now: number, capacity: number): Bucket {
    const existing = buckets.get(clientKey);
    if (existing) return existing;
    if (buckets.size >= this.#maximumBuckets) {
      let oldestKey: string | undefined;
      let oldestSeen = Number.POSITIVE_INFINITY;
      for (const [key, bucket] of buckets) {
        if (bucket.lastSeenAt < oldestSeen) {
          oldestKey = key;
          oldestSeen = bucket.lastSeenAt;
        }
      }
      if (oldestKey) buckets.delete(oldestKey);
    }
    const bucket = { tokens: capacity, updatedAt: now, lastSeenAt: now };
    buckets.set(clientKey, bucket);
    return bucket;
  }
}

export function admissionClientKey(networkKey: string, sessionSecret: string | undefined): string {
  if (!sessionSecret) return `network:${networkKey}`;
  return `session:${createHash("sha256").update(sessionSecret).digest("base64url")}`;
}

export function requestClass(method: string | undefined, pathname: string): AdmissionClass {
  if (method === "POST" && /^\/api\/workspaces\/[^/]+\/latex\/compile$/u.test(pathname)) return "compile";
  if (method === "PUT" && /^\/api\/workspaces\/[^/]+\/assets\/[^/]+\/content$/u.test(pathname)) return "upload";
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return "write";
  return "ordinary";
}
