import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.ts";

export function createSqlClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  return postgres(databaseUrl, { max: Number(process.env.DATABASE_POOL_MAX ?? 1) });
}

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  return drizzle(createSqlClient(databaseUrl), { schema });
}

export function createDbConnection(databaseUrl = process.env.DATABASE_URL) {
  const sql = createSqlClient(databaseUrl);
  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end(),
  };
}

export * from "./schema/index.ts";
