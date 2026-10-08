import manifest from "./icons/manifest.json";

interface IconManifest {
  file: string;
  folder: string;
  folderOpen: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesOpen: Record<string, string>;
}

const M = manifest as IconManifest;
const BASE = `${import.meta.env.BASE_URL}file-icons/`;

function own(map: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** Адрес SVG из Material Icon Theme. Файлы лежат в бандле (public/file-icons), CDN нет. */
export function iconUrl(name: string, isDir: boolean, open = false): string {
  const lower = name.toLowerCase();
  let icon: string | undefined;

  if (isDir) {
    icon = open ? own(M.folderNamesOpen, lower) ?? M.folderOpen : own(M.folderNames, lower) ?? M.folder;
  } else {
    icon = own(M.fileNames, lower);
    if (!icon) {
      const parts = lower.split(".");
      for (let i = 1; i < parts.length && !icon; i += 1) {
        icon = own(M.fileExtensions, parts.slice(i).join("."));
      }
    }
    icon = icon ?? M.file;
  }
  return `${BASE}${icon}.svg`;
}