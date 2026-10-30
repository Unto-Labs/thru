import { describe, expect, it } from "vitest";
import { createPostgresClient } from "./postgres";

// Inspect the real postgres.js client's connection options, not a mocked parser.
describe("PostgreSQL connection URLs", () => {
  it("consumes the Cloud SQL socket parameter without forwarding it to PostgreSQL", async () => {
    const sql = createPostgresClient(
      "postgresql://perps_api:p%40ss@localhost/perps?host=%2Fcloudsql%2Fproject%3Aregion%3Adb&application_name=perps",
    );
    try {
      expect(sql.options.path).toBe("/cloudsql/project:region:db/.s.PGSQL.5432");
      expect(sql.options.user).toBe("perps_api");
      expect(sql.options.pass).toBe("p@ss");
      expect(sql.options.database).toBe("perps");
      expect(sql.options.connection).not.toHaveProperty("host");
      expect(sql.options.connection.application_name).toBe("perps");
    } finally { await sql.end(); }
  });

  it("preserves TCP URLs, TLS settings and caller pool/timeout options", async () => {
    const sql = createPostgresClient(
      "postgresql://perps_worker:password@127.0.0.1:5544/perps?sslmode=require",
      { max: 1, connect_timeout: 10, connection: { statement_timeout: 200 } },
    );
    try {
      expect(sql.options.host).toEqual(["127.0.0.1"]);
      expect(sql.options.port).toEqual([5544]);
      expect(sql.options.path).toBeFalsy();
      expect(sql.options.ssl).toBe("require");
      expect(sql.options.max).toBe(1);
      expect(sql.options.connect_timeout).toBe(10);
      expect(sql.options.connection.statement_timeout).toBe(200);
    } finally { await sql.end(); }
  });

  it("keeps token's explicit host override precedence", async () => {
    const sql = createPostgresClient(
      "postgresql://token:password@localhost/token?host=/cloudsql/default",
      { host: "/custom/socket", max: 2 },
    );
    try {
      expect(sql.options.path).toBe("/custom/socket/.s.PGSQL.5432");
      expect(sql.options.max).toBe(2);
    } finally { await sql.end(); }
  });
});
