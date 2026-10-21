// 活动时间线逻辑测试（对齐官方 map-activity.ts）：
// 1) personActivity：跳过 unavailable/unknown、首次样本不算事件、窗口时间过滤、newest first、20 条上限
// 2) zoneActivity：in_zones 属性数组判定（官方语义）、无 in_zones 时 state 回退、arrived 标记、排序
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

const asserts = [];
const check = (name, cond) => { asserts.push([name, !!cond]); if (!cond) console.error("FAIL:", name); };

// 窗口起始（epoch ms）
const NOW = Date.now();
const SINCE = NOW - 3600 * 1000; // 1 小时窗口
const T = (secAgo) => Math.floor((NOW - secAgo * 1000) / 1000); // state lu（秒）

(async () => {
  const mod = await import("../map-cn.js");
  const { personActivity, zoneActivity } = mod;

  // --- personActivity ---
  // 历史（旧→新）：窗口前 home（起点样本，不算事件）→ 窗口内 not_home → unavailable（跳过）→ 窗口内 home（事件）
  const pHistory = [
    { s: "home", lu: T(7200), a: {} },        // 窗口前（起点基线）
    { s: "not_home", lu: T(1800), a: {} },    // 事件 1
    { s: "unavailable", lu: T(1200), a: {} }, // 跳过
    { s: "home", lu: T(600), a: {} },         // 事件 2
  ];
  const pAct = personActivity(pHistory, SINCE);
  check("personActivity 只留窗口内事件（newest first）", pAct.length === 2);
  check("personActivity newest first", pAct[0].state === "home" && pAct[1].state === "not_home");
  check("personActivity 跳过 unavailable", !pAct.some((e) => e.state === "unavailable"));
  check("personActivity 窗口前起点不算事件", pAct.every((e) => e.when.getTime() >= SINCE));

  // 空历史 / 无历史
  check("personActivity 空历史返回空", personActivity(undefined, SINCE).length === 0);
  check("personActivity 无事件返回空", personActivity([{ s: "home", lu: T(7200), a: {} }], SINCE).length === 0);

  // 20 条上限：21 个事件 → 20
  const many = [];
  for (let i = 0; i < 21; i++) many.push({ s: "state" + i, lu: T(2100 - i * 60), a: {} });
  const capped = personActivity(many, SINCE);
  check("personActivity 20 条上限", capped.length === 20);

  // --- zoneActivity ---
  // 人 A：窗口前在公司（in_zones）→ 离开（不在）→ 回来（arrived）
  // 人 B：无 in_zones 属性（旧版 HA）→ 用 state 回退比较
  const zHistory = {
    "person.a": [
      { s: "zone.company", lu: T(7200), a: { in_zones: ["zone.company"] } },  // 起点基线
      { s: "not_home", lu: T(1800), a: { in_zones: [] } },                     // 离开公司（事件）
      { s: "zone.company", lu: T(600), a: { in_zones: ["zone.company"] } },    // 回到公司（事件）
    ],
    "person.b": [
      { s: "公司", lu: T(7200), a: {} },   // 无 in_zones，state=公司名（旧版 HA）
      { s: "not_home", lu: T(900), a: {} }, // 离开（事件）
    ],
  };
  const zAct = zoneActivity(zHistory, ["person.a", "person.b"], "zone.company", "公司", SINCE);
  check("zoneActivity 3 个事件", zAct.length === 3);
  // newest first 排序
  const times = zAct.map((e) => e.when.getTime());
  check("zoneActivity 按时间倒序", times.every((t, i) => i === 0 || times[i - 1] >= t));
  // 人 A 离开事件（arrived=false）
  const aLeave = zAct.find((e) => e.personId === "person.a" && e.state === "not_home");
  check("zoneActivity 人A 离开 arrived=false", aLeave && aLeave.arrived === false);
  // 人 A 回来事件（arrived=true）
  const aArrive = zAct.find((e) => e.personId === "person.a" && e.state === "zone.company" && e.when.getTime() >= SINCE);
  check("zoneActivity 人A 回来 arrived=true", aArrive && aArrive.arrived === true);
  // 人 B state 回退命中
  const bLeave = zAct.find((e) => e.personId === "person.b");
  check("zoneActivity 人B state 回退（无 in_zones）", bLeave && bLeave.arrived === false);

  // 窗口起点前的状态不算事件（人 A 的起点样本不产生事件）
  check("zoneActivity 起点样本不算事件", !zAct.some((e) => e.personId === "person.a" && e.state === "zone.company" && e.when.getTime() < SINCE));

  const failed = asserts.filter(([, ok]) => !ok);
  console.log(`ACTIVITY TEST ${failed.length === 0 ? "PASS" : "FAIL"} (${asserts.length} checks, ${failed.length} failed)`);
  failed.forEach(([n]) => console.error("  -", n));
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => { console.error("ACTIVITY TEST ERROR", e); process.exit(1); });
