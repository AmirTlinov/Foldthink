export type ServerConfig = Readonly<{
  port: number;
  databaseUrl: string;
  sessionHmacKey: string;
  publicOrigin: string;
  secureCookie: boolean;
  revision: string;
}>;

export function readServerConfig(environment: NodeJS.ProcessEnv): ServerConfig {
  const port = Number(environment.PORT ?? "8787");
  const databaseUrl = environment.DATABASE_URL ?? "";
  const sessionHmacKey = environment.SESSION_HMAC_KEY ?? "";
  const publicOrigin = environment.PUBLIC_ORIGIN ?? "http://localhost:5173";
  const revision = environment.REVISION ?? "development";
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("PORT must be an available TCP port.");
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
  return Object.freeze({
    port,
    databaseUrl,
    sessionHmacKey,
    publicOrigin,
    secureCookie: environment.COOKIE_SECURE !== "false",
    revision,
  });
}
