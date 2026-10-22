// 冒烟测试：在 jsdom 中加载打包产物，验证自定义元素注册与配置校验
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

(async () => {
  await import("../map-cn.js");
  const defined = window.customElements.get("map-cn");
  const editorDefined = window.customElements.get("map-cn-editor");
  console.log("customElements.get('map-cn-editor'):", editorDefined ? editorDefined.name : "NOT DEFINED");
  if (!editorDefined) { console.error("SMOKE FAIL: editor not registered"); process.exit(1); }

  console.log("customElements.get('map-cn'):", defined ? defined.name : "NOT DEFINED");
  const cards = window.customCards || [];
  console.log("customCards:", cards.map((c) => c.type).join(","));
  if (!defined || !cards.find((c) => c.type === "map-cn")) {
    console.error("SMOKE FAIL: element not registered");
    process.exit(1);
  }
  const el = document.createElement("map-cn");
  document.body.appendChild(el);
  let threw = false;
  try {
    el.setConfig({});
  } catch (e) {
    threw = true;
    console.log("empty config throws:", e.message);
  }
  if (!threw) {
    console.error("FAIL: empty config should throw");
    process.exit(1);
  }
  try {
    el.setConfig({ entities: "not-array" });
    console.error("FAIL: non-array entities should throw");
    process.exit(1);
  } catch (e) {
    console.log("non-array entities throws:", e.message);
  }
  el.setConfig({ provider: "gaode", entities: ["person.a", "person.b"], hours_to_show: 24 });
  console.log("setConfig OK, entities:", el._configEntities.length, "cluster:", el._clusterEnabled);

  // 概述 Tabs（与官方一致）：panel 布局按 Tab 过滤实体
  el.setConfig({ provider: "gaode", entities: ["person.a", "person.b", "device_tracker.x", "zone.c"] });
  el.hass = { states: {} };
  el.layout = "panel";
  const idsOf = (arr) => arr.map((e) => e.entity_id);
  const peopleOnly = idsOf(el._displayEntities());
  console.log("panel people tab:", peopleOnly.join(","));
  if (peopleOnly.includes("device_tracker.x") || !peopleOnly.includes("person.a") || !peopleOnly.includes("zone.c")) {
    console.error("FAIL: people tab 过滤错误"); process.exit(1);
  }
  el._handleOverviewTab({ detail: { tab: "devices" } });
  const devicesOnly = idsOf(el._displayEntities());
  console.log("panel devices tab:", devicesOnly.join(","));
  if (!devicesOnly.includes("device_tracker.x") || devicesOnly.includes("person.a")) {
    console.error("FAIL: devices tab 过滤错误"); process.exit(1);
  }
  el.layout = "masonry";
  const allShown = idsOf(el._displayEntities());
  console.log("non-panel all:", allShown.join(","));
  if (allShown.length !== 4) {
    console.error("FAIL: 非 panel 应显示全部实体"); process.exit(1);
  }

  // 仪表盘 strategy 注册（设置→仪表盘→添加仪表盘 出现「中国地图」）
  const customStrategies = window.customStrategies || [];
  const strategyEntry = customStrategies.find(
    (s) => s.type === "map-cn" && s.strategyType === "dashboard"
  );
  console.log("customStrategies:", customStrategies.map((s) => `${s.type}:${s.strategyType}`).join(","));
  const strategyEl = window.customElements.get("ll-strategy-dashboard-map-cn");
  console.log("ll-strategy-dashboard-map-cn:", strategyEl ? "registered" : "NOT DEFINED");
  if (!strategyEntry || !strategyEl) {
    console.error("FAIL: dashboard strategy 未注册"); process.exit(1);
  }
  const gen = await strategyEl.generate({ type: "map-cn" }, {});
  const view = gen.views[0];
  console.log("strategy view:", view.type, "| card:", JSON.stringify(view.cards[0]));
  if (view.type !== "panel" || view.cards[0].type !== "custom:map-cn" || view.cards[0].auto_fit !== true || view.cards[0].show_all !== true) {
    console.error("FAIL: strategy 生成配置与官方 map 不一致"); process.exit(1);
  }
  // overview 抽屉组件注册
  if (!window.customElements.get("map-cn-overview")) {
    console.error("FAIL: map-cn-overview 未注册"); process.exit(1);
  }
  console.log("map-cn-overview: registered");

  // 校验 getCardSize / getStubConfig / getGridOptions
  console.log("getCardSize:", el.getCardSize(), "(aspect 1:1 => 5)");
  el.setConfig({ provider: "tencent", entities: ["device_tracker.x"], aspect_ratio: "16/9" });
  console.log("getCardSize 16/9:", el.getCardSize());
  const grid = el.getGridOptions();
  console.log("getGridOptions:", JSON.stringify(grid));
  if (grid.columns !== "full" || grid.rows !== 4) {
    console.error("FAIL: getGridOptions 与官方不一致"); process.exit(1);
  }

  // 瓦片矩阵
  const tiles = await import("./src/tiles.js");
  console.log("providers:", Object.keys(tiles.TILE_PROVIDERS).join(","));
  const g = tiles.TILE_PROVIDERS.gaode.styles.normal;
  console.log("gaode/normal url0:", g.urls[0]);
  console.log("tianditu requiresKey:", tiles.TILE_PROVIDERS.tianditu.requiresKey);

  // 坐标转换抽查（天安门 WGS-84 -> GCJ-02 应东北向偏移）
  const coord = await import("./src/coord.js");
  const [lng, lat] = coord.toMapCoords(39.9087, 116.3975, "gcj02");
  console.log("gcj02 shift dLng,dLat:", (lng - 116.3975).toFixed(5), (lat - 39.9087).toFixed(5));

  // Overview 尺寸通知（地图 inset/padding 避开抽屉的关键）
  const ov = document.createElement("map-cn-overview");
  ov.getBoundingClientRect = () => ({ width: 360, height: 500, top: 0, left: 0, right: 360, bottom: 500 });
  let resizeEv = null;
  ov.addEventListener("map-overview-resize", (e) => { resizeEv = e; });
  ov._emitSize();
  console.log("overview resize detail:", JSON.stringify(resizeEv && resizeEv.detail));
  if (!resizeEv || resizeEv.detail.width !== 360 || resizeEv.detail.height !== 500) {
    console.error("FAIL: map-overview-resize 事件缺失/尺寸错误"); process.exit(1);
  }

  // 选中暂停 autofit + deselect 恢复（官方 #54774）
  el._config = { auto_fit: true, entities: ["person.a"] };
  el._overviewSelected = "person.a";
  el._autoFitted = true;
  el._map = { truthy: true };
  const updateAllCalls = [];
  el._updateAll = () => { updateAllCalls.push("updateAll"); };
  el._deselect();
  console.log("deselect autoFit reset:", el._autoFitted === false, "| _updateAll:", updateAllCalls.length);
  if (el._autoFitted !== false || updateAllCalls.length === 0) {
    console.error("FAIL: deselect 未恢复自动适配"); process.exit(1);
  }

  console.log("SMOKE PASS");
  process.exit(0);
})().catch((e) => {
  console.error("SMOKE ERROR", e);
  process.exit(1);
});
