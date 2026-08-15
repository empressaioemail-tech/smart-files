import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: node scripts/apply-sql.mjs sql/002_rooms.sql\n");
  process.exit(2);
}
const dsn = readFileSync(join(homedir(), ".empressa", "smart-files.database_url"), "utf8").trim();
if (/fancy-fire|lucky-truth|06136146|tiny-art/.test(dsn)) {
  throw new Error("refusing cortex-prod or smartcity DSN");
}
const sql = readFileSync(file, "utf8");
const client = new pg.Client({ connectionString: dsn });
await client.connect();
const self = await client.query("select current_database() as db");
process.stdout.write(`db=${self.rows[0].db} applying ${file}\n`);
await client.query(sql);
const folders = await client.query("select count(*)::int as n from smart_file_folders");
process.stdout.write(`smart_file_folders=${folders.rows[0].n}\n`);
await client.end();
