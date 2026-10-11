// esbuild 打包：把 lit + maplibre-gl + 卡片源码打成单个 ESM 文件（中国网络环境下无 CDN 依赖）
// CSS（maplibre-gl.css）通过插件内联为 <style> 注入，避免额外的 css 文件依赖
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";

const root = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(root, "..", "map-cn.js");

const inlineCssPlugin = {
  name: "inline-css",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await readFile(args.path, "utf8");
      const js = [
        "const __mapCnCss = " + JSON.stringify(css) + ";",
        "if (typeof document !== 'undefined' && !document.getElementById('map-cn-styles')) {",
        "  const s = document.createElement('style');",
        "  s.id = 'map-cn-styles';",
        "  s.textContent = __mapCnCss;",
        "  (document.head || document.documentElement).appendChild(s);",
        "}",
      ].join("\n");
      return { contents: js, loader: "js" };
    });
  },
};

await build({
  entryPoints: [path.join(root, "src", "map-cn-card.js")],
  bundle: true,
  format: "esm",
  target: ["es2020", "chrome100", "safari15"],
  outfile,
  minify: true,
  legalComments: "none",
  logLevel: "info",
  plugins: [inlineCssPlugin],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

console.log("bundle written:", outfile);
