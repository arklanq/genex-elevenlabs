/**
 * Write the release artifact Studio installs from the catalog: a JSON object of the package's
 * relative file paths to their base64 contents, as `npm run plugin:pack` in Genex Studio writes it.
 * Dotfiles and dot-folders and the editor-only files at the package root stay out, and a link is
 * refused, so the bytes and their sha-256 match the catalog's release record.
 *
 *     node scripts/pack-artifact.mjs <package-folder> <artifact.json>
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const AUTHORING_ONLY = new Set(["jsconfig.json", "tsconfig.json", "plugin-sdk", "AGENTS.md"]);

const [root, output] = process.argv.slice(2);
if (!root || !output) {
  console.error("Usage: node scripts/pack-artifact.mjs <package-folder> <artifact.json>");
  process.exit(1);
}

const files = {};

/** Add every packed file under `relative` ("" at the root) to `files`, in name order. */
async function packFolder(relative) {
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    if (name.startsWith(".") || (relative === "" && AUTHORING_ONLY.has(name))) continue;
    const rel = relative ? `${relative}/${name}` : name;
    const info = await lstat(path.join(root, rel));
    if (info.isSymbolicLink() || !(info.isFile() || info.isDirectory())) {
      throw new Error(`Unsupported package file: ${rel}`);
    }
    if (info.isDirectory()) await packFolder(rel);
    else files[rel] = (await readFile(path.join(root, rel))).toString("base64");
  }
}

await packFolder("");
const bytes = Buffer.from(JSON.stringify(files));
await writeFile(output, bytes);
console.log(`${output} sha256 ${createHash("sha256").update(bytes).digest("hex")}`);
