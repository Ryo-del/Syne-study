import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/editor/editor.all";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme("syne-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1a1f2b",
    "editorGutter.background": "#1a1f2b",
    "editor.lineHighlightBackground": "#202636",
  },
});
monaco.editor.defineTheme("syne-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#fffaf2",
    "editorGutter.background": "#fffaf2",
    "editor.lineHighlightBackground": "#f5ebda",
  },
});

function applyTheme() {
  monaco.editor.setTheme(document.documentElement.dataset.theme === "light" ? "syne-light" : "syne-dark");
}
applyTheme();
new MutationObserver(applyTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});

export { monaco };