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
  // 添加实体：pending 空行不写 config（v0.4.2：不累积 {"entity":""} 垃圾行）
  el._addEntity();
  console.log("after add (pending, config unchanged):", JSON.stringify(lastConfig.entities));
  if (lastConfig.entities.length !== 1) { console.error("FAIL: add 不应写空行进 config"); process.exit(1); }
  // pending 行选好实体 → 提交为真实行
  el._updateEntity(1, { entity: "zone.home" });
  console.log("after pending commit:", JSON.stringify(lastConfig.entities));
  if (lastConfig.entities.length !== 2) { console.error("FAIL: pending 提交"); process.exit(1); }
  // 只有 entity 的行应归一化为字符串
  el._updateEntity(1, { entity: "zone.home", color: "" });
  console.log("normalized:", JSON.stringify(lastConfig.entities));
  const s = lastConfig.entities.find(e => typeof e === "string");
  if (s !== "zone.home") { console.error("FAIL: normalize to string"); process.exit(1); }
  // 空行过滤：更新为空 entity 不产出垃圾行
  el._updateEntity(1, { entity: "" });
  console.log("after clear entity (filtered):", JSON.stringify(lastConfig.entities));
  if (lastConfig.entities.length !== 1) { console.error("FAIL: 空行未过滤"); process.exit(1); }
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

  // ---------- 条件编辑器（v0.4.1） ----------
  el.setConfig({ provider: "gaode", entities: ["person.a"], conditions: [
    { entity: "sensor.temperature", above: "20" },
    { entity: "sensor.door", state: "off" },
  ]});
  await el.updateComplete;
  const condRows = el._conditionRows();
  if (condRows.length !== 2) { console.error("FAIL: condition rows != 2"); process.exit(1); }
  if (condRows[0].type !== "above" || condRows[0].value !== "20") { console.error("FAIL: above 解析"); process.exit(1); }
  if (condRows[1].type !== "state" || condRows[1].value !== "off") { console.error("FAIL: state 解析"); process.exit(1); }
  // 更新条件值 → config-changed 产物正确
  el._updateCondition(0, { value: "25" });
  const c0 = lastConfig.conditions.find((c) => c.entity === "sensor.temperature");
  if (!c0 || c0.above !== "25") { console.error("FAIL: above 更新产物"); process.exit(1); }
  // 添加条件（state_not）
  el._addCondition();
  el._updateCondition(2, { entity: "binary_sensor.motion", type: "state_not", value: "on" });
  const c2 = lastConfig.conditions.find((c) => c.entity === "binary_sensor.motion");
  if (!c2 || c2.state_not !== "on") { console.error("FAIL: state_not 组装"); process.exit(1); }
  // 切换 OR 组合 → { condition: "or", conditions: [...] }
  el._onConditionMode({ target: { value: "any" } });
  const anyCond = lastConfig.conditions;
  if (anyCond.length !== 1 || anyCond[0].condition !== "or" || anyCond[0].conditions.length !== 3) {
    console.error("FAIL: OR 组装", JSON.stringify(anyCond)); process.exit(1);
  }
  // 切回 AND（扁平数组）
  el._onConditionMode({ target: { value: "all" } });
  if (!Array.isArray(lastConfig.conditions) || lastConfig.conditions.length !== 3 || lastConfig.conditions[0].condition === "or") {
    console.error("FAIL: AND 回切"); process.exit(1);
  }
  // 空行过滤（entity 空的条件行不产出）
  el.setConfig({ provider: "gaode", entities: ["person.a"], conditions: [{ entity: "", state: "on" }] });
  await el.updateComplete;
  const filtered = el._buildConditions(el._conditionRows(), false);
  if (filtered !== undefined) { console.error("FAIL: 空行过滤"); process.exit(1); }
  // 删除条件
  el.setConfig({ provider: "gaode", entities: ["person.a"], conditions: [{ entity: "sensor.x", state: "on" }, { entity: "sensor.y", below: "10" }] });
  await el.updateComplete;
  el._removeCondition(0);
  if (lastConfig.conditions.length !== 1 || lastConfig.conditions[0].entity !== "sensor.y") {
    console.error("FAIL: 删除条件"); process.exit(1);
  }
  console.log("条件编辑器数据流 OK");
  console.log("EDITOR DATAFLOW TEST PASS");
  process.exit(0);
})().catch(e => { console.error("EDITOR TEST ERROR", e); process.exit(1); });
