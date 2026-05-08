import { applyMigrations } from "./migrations.ts";

await applyMigrations();
console.log("Database migrations applied.");
