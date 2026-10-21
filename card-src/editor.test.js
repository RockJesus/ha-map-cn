// 编辑器数据流测试：setConfig → 实体行编辑/删除/添加 → config-changed 产物正确
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:8123/", pretendToBeVisual: true,
});
const { window } = dom;
global.window = window; global.document = window.document;
global.customElements = window.customElements; global.HTMLElement = window.HTMLElement;
global.Event = window.Event; global.CustomEvent = window.CustomEvent;
global.navigator = window.navigator; global.getComputedStyle = window.getComputedStyle;
window.URL.createObjectURL = () => "blob:stub"; window.URL.revokeObjectURL = () => {};
class FakeCSSStyleSheet { constructor(){this.cssRules=[];} replaceSync(){} insertRule(r,i=0){return i;} }
global.CSSStyleSheet = FakeCSSStyleSheet; window.CSSStyleSheet = FakeCSSStyleSheet;
Object.defineProperty(window.document, "adoptedStyleSheets", { value: [], writable: true, configurable: true });

(async () => {
  await import("../map-cn.js");
  const Editor = window.customElements.get("map-cn-editor");
  const el = document.createElement("map-cn-editor");
  document.body.appendChild(el);
  let lastConfig = null;
  el.addEventListener("config-changed", (e) => { lastConfig = e.detail.config; });
  el.setConfig({ provider: "gaode", entities: ["person.a", { entity: "person.b", color: "#ff0000" }] });
  el.hass = {};
  // 触发渲染，检查实体行数量
  await el.updateComplete;
  const rows = el.shadowRoot.querySelectorAll(".entity-row");
  console.log("entity rows rendered:", rows.length);
  if (rows.length !== 2) { console.error("FAIL: rows != 2"); process.exit(1); }
  // 修改第 1 行 entity
  el._updateEntity(0, { entity: "device_tracker.car" });
  console.log("after update entity:", JSON.stringify(lastConfig.entities));
  // 删除第 0 行 → 剩下 person.b(color)
  el._removeEntity(0);
  console.log("after remove:", JSON.stringify(lastConfig.entities));
  if (lastConfig.entities.length !== 1 || typeof lastConfig.entities[0] !== "object" || lastConfig.entities[0].entity !== "person.b") {
    console.error("FAIL: remove/merge wrong"); process.exit(1);
  }
  // 添加实体
  el._addEntity();
  console.log("after add:", JSON.stringify(lastConfig.entities));
  if (lastConfig.entities.length !== 2) { console.error("FAIL: add"); process.exit(1); }
  // 只有 entity 的行应归一化为字符串
  el._updateEntity(1, { entity: "zone.home", color: "" });
  console.log("normalized:", JSON.stringify(lastConfig.entities));
  const s = lastConfig.entities.find(e => typeof e === "string");
  if (s !== "zone.home") { console.error("FAIL: normalize to string"); process.exit(1); }
  // show_all 切换
  el._update({ show_all: true });
  console.log("show_all:", lastConfig.show_all);
  // 切换供应商后 config property 同步（即时重渲染修复：v0.3.9）
  el._update({ provider: "tencent" });
  if (el.config?.provider !== "tencent") {
    console.error("FAIL: config property 未同步（切换控件不刷新）");
    process.exit(1);
  }
  console.log("provider 切换同步:", el.config.provider);
  console.log("EDITOR DATAFLOW TEST PASS");
  process.exit(0);
})().catch(e => { console.error("EDITOR TEST ERROR", e); process.exit(1); });
