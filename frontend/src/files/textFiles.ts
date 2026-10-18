import type { FileEntry } from "./types";

const TEXT_EXTENSIONS = new Set(
  `txt md rst adoc log go py pyi pyx js jsx mjs cjs ts tsx mts cts java kt kts scala c h cpp hpp cc hh cxx hxx cs fs vb rs swift m mm php rb rake lua pl pm r dart ex exs erl hrl hs lhs clj cljs cljc elm vue svelte astro html htm css scss sass less styl svg json jsonc json5 yaml yml toml xml ini cfg conf env properties editorconfig sql prisma graphql gql sh bash zsh fish bat cmd ps1 psm1 dockerfile tf tfvars hcl nix service mod sum work makefile mk cmake gradle groovy lock http rest feature proto pddl csv tsv graphqls pem crt cer pub`.split(" "),
);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  md: "markdown", rst: "restructuredtext", adoc: "asciidoc", log: "plaintext",
  go: "go", py: "python", pyi: "python", pyx: "cython", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", c: "c", h: "cpp", cpp: "cpp", hpp: "cpp",
  cc: "cpp", hh: "cpp", cxx: "cpp", hxx: "cpp", cs: "csharp", fs: "fsharp", vb: "vb", rs: "rust",
  swift: "swift", m: "objective-c", mm: "objective-c", php: "php", rb: "ruby", rake: "ruby", lua: "lua",
  pl: "perl", pm: "perl", r: "r", dart: "dart", ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang",
  hs: "haskell", lhs: "haskell", clj: "clojure", cljs: "clojure", cljc: "clojure", elm: "elm", vue: "html",
  svelte: "html", astro: "html", html: "html", htm: "html", css: "css", scss: "scss", sass: "scss", less: "less",
  styl: "stylus", svg: "xml", json: "json", jsonc: "json", json5: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  xml: "xml", ini: "ini", cfg: "ini", conf: "ini", env: "ini", properties: "ini", editorconfig: "ini", sql: "sql",
  prisma: "graphql", graphql: "graphql", gql: "graphql", sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  bat: "bat", cmd: "bat", ps1: "powershell", psm1: "powershell", dockerfile: "dockerfile", tf: "hcl", tfvars: "hcl",
  hcl: "hcl", nix: "nix", service: "ini", mod: "go", sum: "plaintext", work: "go", makefile: "makefile", mk: "makefile",
  cmake: "cmake", gradle: "groovy", groovy: "groovy", lock: "toml", http: "http", rest: "http", feature: "gherkin",
  proto: "protobuf", pddl: "plaintext", csv: "plaintext", tsv: "plaintext", graphqls: "graphql", pem: "plaintext",
  crt: "plaintext", cer: "plaintext", pub: "plaintext",
};

export function isEditableTextFile(entry: FileEntry): boolean {
  if (entry.is_dir) return false;
  const name = entry.name.toLowerCase();
  if (name === "makefile" || name === "dockerfile") return true;
  const ext = name.startsWith(".") && !name.slice(1).includes(".") ? name.slice(1) : name.split(".").pop() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

export function editorLanguage(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "makefile") return "makefile";
  if (lower === "dockerfile") return "dockerfile";
  const ext = lower.startsWith(".") && !lower.slice(1).includes(".") ? lower.slice(1) : lower.split(".").pop() ?? "";
  return LANGUAGE_BY_EXTENSION[ext] ?? "plaintext";
}
