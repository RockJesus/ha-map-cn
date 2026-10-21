// 实体收集逻辑测试：show_all / geo_location_sources / person-source 排除 / 隐藏实体
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

// mock hass states：person 带 source（其 tracker 会被排除）+ 独立 tracker + zone + 隐藏实体 + geo_location
const states = {
  "person.zhangsan": {
    entity_id: "person.zhangsan",
    state: "home",
    attributes: {
      source: "device_tracker.phone",
      latitude: 39.907, longitude: 116.391,
      source_entity: "device_tracker.phone",
      friendly_name: "张三",
    },
  },
  "device_tracker.phone": {
    entity_id: "device_tracker.phone",
    state: "home",
    attributes: { latitude: 39.907, longitude: 116.391, source_type: "gps", friendly_name: "手机" },
  },
  "device_tracker.car": {
    entity_id: "device_tracker.car",
    state: "not_home",
    attributes: { latitude: 40.0, longitude: 116.5, source_type: "gps", friendly_name: "车" },
  },
  "zone.home": {
    entity_id: "zone.home",
    state: "zoning",
    attributes: { latitude: 39.9, longitude: 116.4, radius: 100, friendly_name: "家" },
  },
  "zone.hidden_zone": {
    entity_id: "zone.hidden_zone",
    state: "zoning",
    attributes: { latitude: 39.8, longitude: 116.3, radius: 50, friendly_name: "隐藏" },
  },
  "sensor.temperature": {
    entity_id: "sensor.temperature",
    state: "21.5",
    attributes: { unit_of_measurement: "°C", friendly_name: "温度" },
  },
  "geo_location.eiffel": {
    entity_id: "geo_location.eiffel",
    state: "0",
    attributes: { source: "gpslogger", latitude: 48.858, longitude: 2.294, friendly_name: "埃菲尔" },
  },
  "geo_location.fuji": {
    entity_id: "geo_location.fuji",
    state: "0",
    attributes: { source: "icloud", latitude: 35.36, longitude: 138.73, friendly_name: "富士山" },
  },
};
// 隐藏实体：zone.hidden_zone 与 person.zhangsan 的 tracker 显示隐藏
const entityRegistry = {
  "person.zhangsan": { hidden: false },
  "device_tracker.phone": { hidden: true },   // person 的 source tracker 隐藏
  "zone.hidden_zone": { hidden: true },
};

const asserts = [];
const check = (name, cond) => {
  asserts.push([name, !!cond]);
  if (!cond) console.error("FAIL:", name);
};

(async () => {
  const mod = await import("../map-cn.js");
  const card = document.createElement("map-cn");
  card.hass = { states, entities: entityRegistry, themes: { darkMode: false } };
  card.setConfig({ show_all: true });
  card._config = { ...card._config };
  card._config.entities = card._getAllEntities();
  card._configEntities = (card._config.entities || []).map((e) =>
    typeof e === "string" ? { entity: e } : { ...e }
  );

  const all = card._getAllEntities();
  // 有位置的实体：person.zhangsan, device_tracker.car, zone.home, geo_location.eiffel, geo_location.fuji
  // 排除：device_tracker.phone（person 的 source）、zone.hidden_zone（隐藏）、sensor（无位置）
  check("show_all 收集有位置实体", all.includes("person.zhangsan") && all.includes("device_tracker.car") && all.includes("zone.home"));
  check("show_all 排除 person 的 source tracker", !all.includes("device_tracker.phone"));
  check("show_all 排除隐藏实体", !all.includes("zone.hidden_zone"));
  check("show_all 不含无位置实体", !all.includes("sensor.temperature"));
  check("show_all 含 geo_location", all.includes("geo_location.eiffel") && all.includes("geo_location.fuji"));

  // geo_location_sources 过滤（all + 指定 source）
  card.setConfig({ geo_location_sources: [{ source: "gpslogger", label_mode: "name" }] });
  card._config = { ...card._config };
  const sources = card._getSourceEntities();
  check("指定 source 只收 gpslogger", sources.length === 1 && sources[0].entity_id === "geo_location.eiffel");
  check("source label_mode 继承", sources[0].label_mode === "name" && sources[0].focus === true);

  card.setConfig({ geo_location_sources: ["all"] });
  card._config = { ...card._config };
  const allSources = card._getSourceEntities();
  check("source=all 收全部 geo_location", allSources.length === 2);

  // 字符串 source 归一化
  card.setConfig({ geo_location_sources: ["icloud"] });
  card._config = { ...card._config };
  const icloud = card._getSourceEntities();
  check("字符串 source 归一化", icloud.length === 1 && icloud[0].entity_id === "geo_location.fuji");

  // _mapEntities 结构：实体行 → {entity_id, color, label_mode...}（坐标在渲染时从 state 读取，
  // zone 半径圈由 show_zone_radius + zone state radius 控制，与官方一致）
  card.setConfig({
    entities: [
      { entity: "person.zhangsan", color: "#ff0000" },
      "device_tracker.car",
      { entity: "zone.home", radius: true },
    ],
  });
  card._configEntities = card._config.entities.map((e) =>
    typeof e === "string" ? { entity: e } : { ...e }
  );
  const mapEntities = card._mapEntities();
  check("mapEntities 数量=3", mapEntities.length === 3);
  const p = mapEntities.find((e) => e.entity_id === "person.zhangsan");
  check("person 实体带颜色", p && p.color === "#ff0000");
  check("mapEntities 含 zone.home", mapEntities.some((e) => e.entity_id === "zone.home"));
  check("mapEntities 含 device_tracker.car", mapEntities.some((e) => e.entity_id === "device_tracker.car"));

  const failed = asserts.filter(([, ok]) => !ok);
  console.log(`ENTITIES TEST ${failed.length === 0 ? "PASS" : "FAIL"} (${asserts.length} checks, ${failed.length} failed)`);
  failed.forEach(([n]) => console.error("  -", n));
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error("ENTITIES TEST ERROR", e); process.exit(1); });
