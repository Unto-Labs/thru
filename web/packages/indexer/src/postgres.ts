import postgres, { type Sql } from "postgres";

/* postgres.js does not interpret libpq's ?host= URL parameter. Cloud Run's
   built-in Cloud SQL connection supplies a Unix socket directory there.
   Consume it here rather than sending it as a PostgreSQL startup parameter. */
export function createPostgresClient(
  databaseUrl: string,
  options: postgres.Options<Record<string, never>> = {},
): Sql<Record<string, unknown>> {
  const parsedUrl = new URL(databaseUrl);
  const socketHost = parsedUrl.searchParams.get("host")?.trim();
  if (socketHost) parsedUrl.searchParams.delete("host");

  return postgres(parsedUrl.toString(), {
    max: 10,
    ...(socketHost ? { host: socketHost } : {}),
    ...options,
  });
}
