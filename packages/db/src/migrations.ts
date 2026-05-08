import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export async function applyMigrations(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const [applied] = await sql<{ id: string }[]>`select id from schema_migrations where id = ${file}`;
      if (applied) continue;

      const migration = await readFile(join(migrationsDir, file), "utf8");
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction`insert into schema_migrations (id) values (${file})`;
      });
    }
  } finally {
    await sql.end();
  }
}
