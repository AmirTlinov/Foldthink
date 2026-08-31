declare const __FOLDTHINK_BUILD_REVISION__: string | undefined;
declare const __FOLDTHINK_SCHEMA_MIGRATION__: string | undefined;

export type ReleaseIdentity = Readonly<{
  revision: string;
  requiredSchemaMigration?: string;
  production: boolean;
}>;

function compiledValue(name: "revision" | "schema"): string | undefined {
  const value = name === "revision"
    ? typeof __FOLDTHINK_BUILD_REVISION__ === "undefined" ? undefined : __FOLDTHINK_BUILD_REVISION__
    : typeof __FOLDTHINK_SCHEMA_MIGRATION__ === "undefined" ? undefined : __FOLDTHINK_SCHEMA_MIGRATION__;
  return value?.trim() || undefined;
}

export function readReleaseIdentity(environment: NodeJS.ProcessEnv): ReleaseIdentity {
  const production = environment.NODE_ENV === "production";
  const compiledRevision = compiledValue("revision");
  const compiledSchema = compiledValue("schema");
  const runtimeRevision = environment.REVISION?.trim();
  const runtimeSchema = environment.REQUIRED_SCHEMA_MIGRATION?.trim();

  if (production && (!compiledRevision || !compiledSchema)) {
    throw new TypeError("A production server must contain its source revision and required schema migration.");
  }
  if (production && !runtimeRevision) {
    throw new TypeError("REVISION is required in production.");
  }
  if (compiledRevision && runtimeRevision && compiledRevision !== runtimeRevision) {
    throw new TypeError("REVISION does not match the immutable application artifact.");
  }
  if (compiledSchema && runtimeSchema && compiledSchema !== runtimeSchema) {
    throw new TypeError("REQUIRED_SCHEMA_MIGRATION does not match the immutable application artifact.");
  }

  const requiredSchemaMigration = compiledSchema ?? runtimeSchema;
  return Object.freeze({
    revision: compiledRevision ?? runtimeRevision ?? "development",
    ...(requiredSchemaMigration ? { requiredSchemaMigration } : {}),
    production,
  });
}
