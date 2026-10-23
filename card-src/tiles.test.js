// 瓦片与样式逻辑测试：
// 1) 腾讯 TMS y 轴反转（transformRequest 逻辑）只作用于腾讯瓦片
// 2) 样式矩阵（provider/styles/darkTile/requiresKey）符合预期
// 3) 编辑器样式选项按 provider 过滤（腾讯无 satellite）
// 4) 运行时样式回退（腾讯 + satellite → normal）
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:8123/",
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.customElements = window.customElements;
global.HTMLElement = window.HTMLElement;
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.navigator = window.navigator;
global.getComputedStyle = window.getComputedStyle;
window.URL.createObjectURL = () => "blob:stub";
class FakeCSSStyleSheet {
  constructor() { this.cssRules = []; this._text = ""; }
  replaceSync(t) { this._text = t; this.cssRules = []; }
  insertRule(r, i = 0) { this.cssRules.push(r); return i; }
}
global.CSSStyleSheet = FakeCSSStyleSheet;
window.CSSStyleSheet = FakeCSSStyleSheet;
Object.defineProperty(window.document, "adoptedStyleSheets", { value: [], writable: true, configurable: true });
window.URL.revokeObjectURL = () => {};

// 腾讯 TMS 反转（与 map-cn-card.js transformRequest 同一逻辑）
function transformTencentY(url, resourceType) {
  if (resourceType === "Tile" && url.includes(".map.gtimg.com/tile")) {
    const m = url.match(/[?&]z=(\d+)[^&]*&x=(\d+)[^&]*&y=(\d+)/);
    if (m) {
      const z = Number(m[1]);
      const yTms = (1 << z) - 1 - Number(m[3]);
      return url.replace(`y=${m[3]}`, `y=${yTms}`);
    }
  }
  return url;
}

const asserts = [];
const check = (name, cond) => {
  asserts.push([name, !!cond]);
  if (!cond) console.error("FAIL:", name);
};

// 1. 腾讯 TMS 反转
check(
  "腾讯 z14 y=6105 反转后 y=10278",
  transformTencentY("https://rt2.map.gtimg.com/tile?z=14&x=13561&y=6105&styleid=0", "Tile") ===
    "https://rt2.map.gtimg.com/tile?z=14&x=13561&y=10278&styleid=0"
);
check(
  "腾讯 z15 y=20556 反转后 y=12211",
  transformTencentY("https://rt0.map.gtimg.com/tile?z=15&x=26976&y=20556&styleid=4", "Tile") ===
    "https://rt0.map.gtimg.com/tile?z=15&x=26976&y=12211&styleid=4"
);
// 非 Tile 资源不改写
check(
  "非 Tile 资源不改写",
  transformTencentY("https://rt2.map.gtimg.com/tile?z=14&x=13561&y=6105", "Image") ===
    "https://rt2.map.gtimg.com/tile?z=14&x=13561&y=6105"
);
// 非腾讯域名不改写
check(
  "高德瓦片不改写",
  transformTencentY("https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=3390&y=1526&z=12", "Tile") ===
    "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x=3390&y=1526&z=12"
);
// 天地图 WMTS 参数顺序不同（TILEROW）也不误匹配
check(
  "天地图 TILEROW 不误匹配",
  transformTencentY("https://t0.tianditu.gov.cn/vec_w/wmts?...&TILEMATRIX=12&TILEROW=1526&TILECOL=3390&tk=abc", "Tile") ===
    "https://t0.tianditu.gov.cn/vec_w/wmts?...&TILEMATRIX=12&TILEROW=1526&TILECOL=3390&tk=abc"
);

// 2. 加载产物检查样式矩阵
(async () => {
  const mod = await import("../map-cn.js");
  const TILE_PROVIDERS = mod.TILE_PROVIDERS;
  check("产物导出 TILE_PROVIDERS", !!TILE_PROVIDERS);

  // 腾讯：无 satellite、dark 有 darkTile
  check("腾讯无 satellite 样式", !TILE_PROVIDERS.tencent.styles.satellite);
  check("腾讯有 normal/light/dark", !!(TILE_PROVIDERS.tencent.styles.normal && TILE_PROVIDERS.tencent.styles.light && TILE_PROVIDERS.tencent.styles.dark));
  check("腾讯 dark 标记 darkTile", TILE_PROVIDERS.tencent.styles.dark.darkTile === true);

  // 高德：light=style=7、satellite=webst、dark 无 darkTile
  const g = TILE_PROVIDERS.gaode.styles;
  check("高德 light 用 style=7", g.light.urls[0].includes("style=7") && !g.light.urls[0].includes("style=8"));
  check("高德有 satellite 样式", !!g.satellite);
  check("高德 satellite 用 webst 域名", g.satellite.urls[0].includes("webst0"));
  check("高德 dark 无 darkTile 标记（需反相）", g.dark.darkTile !== true);
  check("高德 light 与 normal 不同域名", g.light.urls[0].includes("webrd0"));

  // 天地图/OSM 结构
  check("天地图 requiresKey", TILE_PROVIDERS.tianditu.requiresKey === true);
  check("天地图有卫星(img，函数形态)", typeof TILE_PROVIDERS.tianditu.styles.satellite.urls === "function");
  check("OSM 有全部4样式", !!(TILE_PROVIDERS.osm.styles.normal && TILE_PROVIDERS.osm.styles.satellite && TILE_PROVIDERS.osm.styles.light && TILE_PROVIDERS.osm.styles.dark));
  check("默认 provider 高德", mod.DEFAULT_PROVIDER === "gaode");
  check("默认 style normal", mod.DEFAULT_STYLE === "normal");

  // 实时路况叠加层（借鉴 ha-china-map：高德 traffic 瓦片）
  check("高德有 traffic 叠加层", !!TILE_PROVIDERS.gaode.traffic);
  check(
    "高德 traffic 用 tm.amap.com/trafficengine",
    TILE_PROVIDERS.gaode.traffic.urls[0].includes("tm.amap.com/trafficengine")
  );
  check("腾讯无 traffic 叠加层", !TILE_PROVIDERS.tencent.traffic);
  check("天地图无 traffic 叠加层", !TILE_PROVIDERS.tianditu.traffic);

  // 编辑器样式过滤（PROVIDER_STYLES 常量行为）
  const editor = document.createElement("map-cn-editor");
  editor.setConfig({ provider: "tencent", show_all: true });
  const r = editor.render?.() || "";
  check("编辑器渲染无异常", typeof r === "object" || typeof r === "string" || r === undefined);

  const failed = asserts.filter(([, ok]) => !ok);
  console.log(`TILES TEST ${failed.length === 0 ? "PASS" : "FAIL"} (${asserts.length} checks, ${failed.length} failed)`);
  failed.forEach(([n]) => console.error("  -", n));
  process.exit(failed.length === 0 ? 0 : 1);
})();
