import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsSrc = path.join(
  root,
  "node_modules",
  "material-icon-theme",
  "icons",
);
const outDir = path.join(root, "public", "file-icons");
const manifestOut = path.join(root, "src", "files", "icons", "manifest.json");

if (!existsSync(iconsSrc)) {
  console.error(
    "[file-icons] material-icon-theme is not installed: npm install -D material-icon-theme",
  );
  process.exit(1);
}

const mod = await import("material-icon-theme");
const generateManifest = mod.generateManifest ?? mod.default?.generateManifest;
if (typeof generateManifest !== "function") {
  console.error(
    "[file-icons] generateManifest not found in material-icon-theme",
  );
  process.exit(1);
}

const m = generateManifest();
const defs = m.iconDefinitions ?? {};
const used = new Set();

function pick(id) {
  if (!id) return null;
  const def = defs[id];
  const file = def?.iconPath ? path.basename(def.iconPath, ".svg") : id;
  if (!existsSync(path.join(iconsSrc, `${file}.svg`))) return null;
  used.add(file);
  return file;
}

function mapOf(obj) {
  const out = {};
  for (const [key, id] of Object.entries(obj ?? {})) {
    const file = pick(id);
    if (file) out[key.toLowerCase()] = file;
  }
  return out;
}

const result = {
  file: pick(m.file) ?? pick("file"),
  folder: pick(m.folder) ?? pick("folder"),
  folderOpen: pick(m.folderExpanded) ?? pick("folder-open"),
  fileNames: mapOf(m.fileNames),
  fileExtensions: mapOf(m.fileExtensions),
  folderNames: mapOf(m.folderNames),
  folderNamesOpen: mapOf(m.folderNamesExpanded),
};

// Расширения, которые в манифесте идут через languageIds.
for (const [ext, id] of Object.entries({ txt: "document", log: "log" })) {
  if (!result.fileExtensions[ext]) {
    const file = pick(id);
    if (file) result.fileExtensions[ext] = file;
  }
}

if (!result.file || !result.folder || !result.folderOpen) {
  console.error(
    "[file-icons] default icons (file/folder/folder-open) were not found",
  );
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const file of used) {
  copyFileSync(
    path.join(iconsSrc, `${file}.svg`),
    path.join(outDir, `${file}.svg`),
  );
}
mkdirSync(path.dirname(manifestOut), { recursive: true });
writeFileSync(manifestOut, JSON.stringify(result));

console.log(
  `[file-icons] ${used.size} icons, ${Object.keys(result.fileNames).length} names, ` +
    `${Object.keys(result.fileExtensions).length} extensions, ${Object.keys(result.folderNames).length} folders`,
);
