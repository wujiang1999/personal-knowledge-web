import { readdir } from "node:fs/promises";
import { getAttachmentRoot } from "../lib/attachments";
import { closePool, query } from "../lib/db";
import { loadEnv } from "./load-env";

async function main(): Promise<void> {
  loadEnv();
  const root = getAttachmentRoot();
  const rows = await query<{ storage_key: string }>("SELECT storage_key FROM attachments");
  const databaseKeys = new Set(rows.rows.map((row) => row.storage_key));
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const fileKeys = new Set(
    entries.filter((entry) => entry.isFile() && !entry.name.endsWith(".uploading")).map((entry) => entry.name),
  );
  const missing = [...databaseKeys].filter((key) => !fileKeys.has(key));
  const orphaned = [...fileKeys].filter((key) => !databaseKeys.has(key));

  console.log(`attachments: database=${databaseKeys.size} files=${fileKeys.size} missing=${missing.length} orphaned=${orphaned.length}`);
  if (missing.length) console.error(`missing storage keys: ${missing.slice(0, 20).join(", ")}`);
  if (orphaned.length) console.error(`orphaned storage keys: ${orphaned.slice(0, 20).join(", ")}`);
  if (missing.length || orphaned.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("attachment audit failed", error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
