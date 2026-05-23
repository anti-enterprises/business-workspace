import fs from "node:fs";
import path from "node:path";
import { query, closePool } from "./client.js";

const REQUIRED_TABLES = [
  "offers",
  "campaigns",
  "companies",
  "contacts",
  "engagements",
  "campaign_contacts",
  "messages",
  "account_activity",
  "tool_usage",
  "signal_routing_audit",
  "reviews",
];

async function tableExists(tableName: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     )`,
    [tableName],
  );
  return result.rows[0]?.exists ?? false;
}

async function getMissingTables(): Promise<string[]> {
  const missing: string[] = [];
  for (const table of REQUIRED_TABLES) {
    if (!(await tableExists(table))) {
      missing.push(table);
    }
  }
  return missing;
}

function findSchemaFile(): string {
  // Try common locations relative to cwd
  const candidates = [
    path.join(process.cwd(), "execution", "db", "schema.sql"),
    path.join(process.cwd(), "dist", "db", "schema.sql"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `schema.sql not found. Looked at:\n  ${candidates.join("\n  ")}`,
  );
}

async function applySchema(): Promise<void> {
  const schemaPath = findSchemaFile();
  const sql = fs.readFileSync(schemaPath, "utf-8");
  await query(sql);
}

export async function setupDatabase(opts: { force?: boolean } = {}): Promise<{
  status: "ready" | "created" | "error";
  tables: string[];
  message: string;
}> {
  try {
    // Test connection
    await query("SELECT 1");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      tables: [],
      message: `Cannot connect to database: ${message}`,
    };
  }

  const missing = await getMissingTables();

  if (missing.length === 0 && !opts.force) {
    return {
      status: "ready",
      tables: REQUIRED_TABLES,
      message: `All ${REQUIRED_TABLES.length} tables present`,
    };
  }

  if (missing.length > 0) {
    console.log(`Missing tables: ${missing.join(", ")}`);
  }

  if (opts.force) {
    console.log("Force flag set — reapplying full schema");
  }

  console.log("Applying schema...");
  try {
    await applySchema();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      tables: REQUIRED_TABLES.filter((t) => !missing.includes(t)),
      message: `Schema apply failed: ${message}`,
    };
  }

  // Verify
  const stillMissing = await getMissingTables();
  if (stillMissing.length > 0) {
    return {
      status: "error",
      tables: REQUIRED_TABLES.filter((t) => !stillMissing.includes(t)),
      message: `Tables still missing after apply: ${stillMissing.join(", ")}`,
    };
  }

  return {
    status: "created",
    tables: REQUIRED_TABLES,
    message: `Created ${missing.length} tables, ${REQUIRED_TABLES.length} total`,
  };
}

// CLI entry point
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("setup.js") ||
    process.argv[1].endsWith("setup.ts") ||
    process.argv[1].includes("db/setup"));

if (isMain) {
  const force = process.argv.includes("--force");
  setupDatabase({ force })
    .then((result) => {
      if (result.status === "error") {
        console.error(`[DB] ERROR: ${result.message}`);
        process.exit(1);
      }
      console.log(`[DB] ${result.status.toUpperCase()}: ${result.message}`);
    })
    .catch((err) => {
      console.error("[DB] Fatal:", err);
      process.exit(1);
    })
    .finally(() => closePool());
}
