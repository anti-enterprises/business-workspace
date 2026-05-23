import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parse, stringify } from "yaml";
import {
  Source,
  PulseSourceFile,
  RepoSourceFile,
  StrategicRole,
  ROLE_FILENAMES,
  STRATEGIC_ROLES,
  mergeSources,
} from "../types/source.js";

const WORKSPACE_ID = process.env.PULSE_WORKSPACE_ID ?? "business-workspace";
const PULSE_PATH = join(
  process.env.HOME!,
  ".pulse/workspaces",
  WORKSPACE_ID,
  "sources/sources.yaml",
);
const REPO_SOURCES_DIR = join(process.cwd(), "sources");

function filenameToRole(filename: string): StrategicRole | undefined {
  for (const [role, fname] of Object.entries(ROLE_FILENAMES)) {
    if (fname === filename) return role as StrategicRole;
  }
  return undefined;
}

function readPulseSources(): Source[] {
  if (!existsSync(PULSE_PATH)) {
    console.error(`Pulse sources not found at ${PULSE_PATH}`);
    process.exit(1);
  }
  const raw = parse(readFileSync(PULSE_PATH, "utf-8"));
  const parsed = PulseSourceFile.parse(raw);
  return parsed.sources;
}

function readRepoSources(): Source[] {
  if (!existsSync(REPO_SOURCES_DIR)) return [];
  const files = readdirSync(REPO_SOURCES_DIR).filter((f) => f.endsWith(".yaml"));
  const sources: Source[] = [];
  for (const file of files) {
    const raw = parse(readFileSync(join(REPO_SOURCES_DIR, file), "utf-8"));
    const parsed = RepoSourceFile.parse(raw);
    sources.push(...parsed.sources);
  }
  return sources;
}

function toMap(sources: Source[]): Map<string, Source> {
  const map = new Map<string, Source>();
  for (const s of sources) map.set(s.id, s);
  return map;
}

function pull() {
  console.log("Pulling sources from Pulse → repo...\n");
  const pulseSources = readPulseSources();
  const repoSources = readRepoSources();

  const { merged, added, updated, unchanged } = mergeSources(
    toMap(repoSources),
    toMap(pulseSources),
  );

  // Group by strategic_role
  const byRole = new Map<StrategicRole, Source[]>();
  for (const s of merged) {
    const list = byRole.get(s.strategic_role) || [];
    list.push(s);
    byRole.set(s.strategic_role, list);
  }

  // Write repo files
  mkdirSync(REPO_SOURCES_DIR, { recursive: true });
  for (const [role, sources] of byRole) {
    const filename = ROLE_FILENAMES[role];
    const content: RepoSourceFile = {
      schema_version: "1",
      strategic_role: role,
      sources,
    };
    writeFileSync(
      join(REPO_SOURCES_DIR, filename),
      stringify(content, { lineWidth: 120 }),
    );
    console.log(`  ${filename}: ${sources.length} sources`);
  }

  console.log(`\nDone. Added: ${added}, Updated: ${updated}, Unchanged: ${unchanged}`);
}

function push() {
  console.log("Pushing sources from repo → Pulse...\n");
  const repoSources = readRepoSources();
  if (repoSources.length === 0) {
    console.error("No repo sources found. Run 'pull' first to bootstrap.");
    process.exit(1);
  }

  const pulseSources = readPulseSources();
  const { merged, added, updated, unchanged } = mergeSources(
    toMap(repoSources),
    toMap(pulseSources),
  );

  // Write Pulse file
  const content: PulseSourceFile = {
    schema_version: "1",
    typed_at: new Date().toISOString().split("T")[0],
    sources: merged,
  };
  writeFileSync(PULSE_PATH, stringify(content, { lineWidth: 120 }));

  console.log(`  Written ${merged.length} sources to Pulse`);
  console.log(`\nDone. Added: ${added}, Updated: ${updated}, Unchanged: ${unchanged}`);
}

const command = process.argv[2] || "pull";

if (command === "pull") {
  pull();
} else if (command === "push") {
  push();
} else {
  console.error(`Unknown command: ${command}. Use 'pull' or 'push'.`);
  process.exit(1);
}
