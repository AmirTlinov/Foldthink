import { isAbsolute } from "node:path";
import { readReleaseIdentity } from "./release-identity.js";

export type AssetStorageConfig =
  | Readonly<{
      kind: "filesystem";
      directory: string;
    }>
  | Readonly<{
      kind: "s3";
      bucket: string;
      region: string;
      endpoint?: string;
      forcePathStyle: boolean;
      accessKeyId: string;
      secretAccessKey: string;
    }>;

export type ServerConfig = Readonly<{
  port: number;
  databaseUrl: string;
  sessionHmacKey: string;
  publicOrigin: string;
  secureCookie: boolean;
  revision: string;
  requiredSchemaMigration?: string;
  production: boolean;
  backupRetentionDays: number;
  assets: AssetStorageConfig;
  latex: Readonly<{
    tectonicBinary?: string;
    pdfInfoBinary?: string;
    pdfToCairoBinary?: string;
    bundlePath?: string;
    cacheDirectory?: string;
  }>;
}>;

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new TypeError(`${name} is required.`);
  return value;
}

function readAssetStorage(environment: NodeJS.ProcessEnv): AssetStorageConfig {
  const kind = environment.ASSET_BACKEND ?? "filesystem";
  if (kind === "filesystem") {
    const directory = required(environment, "ASSET_DIRECTORY");
    if (!isAbsolute(directory)) throw new TypeError("ASSET_DIRECTORY must be absolute.");
    return Object.freeze({ kind, directory });
  }
  if (kind !== "s3") throw new TypeError("ASSET_BACKEND must be filesystem or s3.");
  const endpoint = environment.ASSET_S3_ENDPOINT?.trim();
  if (endpoint) new URL(endpoint);
  return Object.freeze({
    kind,
    bucket: required(environment, "ASSET_S3_BUCKET"),
    region: required(environment, "ASSET_S3_REGION"),
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: environment.ASSET_S3_FORCE_PATH_STYLE === "true",
    accessKeyId: required(environment, "ASSET_S3_ACCESS_KEY_ID"),
    secretAccessKey: required(environment, "ASSET_S3_SECRET_ACCESS_KEY"),
  });
}

export function readServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const port = Number(environment.PORT ?? "8787");
  const databaseUrl = environment.DATABASE_URL ?? "";
  const sessionHmacKey = environment.SESSION_HMAC_KEY ?? "";
  const publicOrigin = environment.PUBLIC_ORIGIN ?? "http://localhost:5173";
  const release = readReleaseIdentity(environment);
  const backupRetentionDays = Number(environment.BACKUP_RETENTION_DAYS ?? "30");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("PORT must be an available TCP port.");
  }
  if (!Number.isInteger(backupRetentionDays) || backupRetentionDays < 1 || backupRetentionDays > 365) {
    throw new TypeError("BACKUP_RETENTION_DAYS must be between one and 365.");
  }
  if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    throw new TypeError("DATABASE_URL must be a PostgreSQL connection URL.");
  }
  if (Buffer.byteLength(sessionHmacKey, "utf8") < 32) {
    throw new TypeError("SESSION_HMAC_KEY must contain at least 32 bytes.");
  }
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin) {
    throw new TypeError("PUBLIC_ORIGIN must contain only an origin.");
  }
  const bundlePath = environment.LATEX_BUNDLE_PATH?.trim();
  if (bundlePath && !isAbsolute(bundlePath)) {
    throw new TypeError("LATEX_BUNDLE_PATH must be absolute when configured.");
  }
  const cacheDirectory = environment.LATEX_CACHE_DIRECTORY?.trim();
  if (cacheDirectory && !isAbsolute(cacheDirectory)) {
    throw new TypeError("LATEX_CACHE_DIRECTORY must be absolute when configured.");
  }
  return Object.freeze({
    port,
    databaseUrl,
    sessionHmacKey,
    publicOrigin,
    secureCookie: environment.COOKIE_SECURE !== "false",
    revision: release.revision,
    ...(release.requiredSchemaMigration ? { requiredSchemaMigration: release.requiredSchemaMigration } : {}),
    production: release.production,
    backupRetentionDays,
    assets: readAssetStorage(environment),
    latex: Object.freeze({
      ...(environment.TECTONIC_BINARY ? { tectonicBinary: environment.TECTONIC_BINARY } : {}),
      ...(environment.PDFINFO_BINARY ? { pdfInfoBinary: environment.PDFINFO_BINARY } : {}),
      ...(environment.PDFTOCAIRO_BINARY ? { pdfToCairoBinary: environment.PDFTOCAIRO_BINARY } : {}),
      ...(bundlePath ? { bundlePath } : {}),
      ...(cacheDirectory ? { cacheDirectory } : {}),
    }),
  });
}
