/** Minimal .env loader for CLI scripts (Next loads .env itself; tsx does not). Never overrides existing vars. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), ".env");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
