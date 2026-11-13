/**
 * 中国地图卡片（China Map Card）for Home Assistant — 源码入口
 *
 * 这是构建前的源码入口：import 卡片主类与可视化编辑器并注册自定义元素。
 * 发布产物 ha-cn-map-card.js 由 esbuild 把 src/ 打成单文件（`pnpm build`），
 * HA 的 Lovelace 资源只加载那一个文件。
 *
 * 零运行时依赖：内置轻量 XYZ 瓦片引擎（投影/平移/缩放/标记），不引 Leaflet。
 * 底图：amap（高德，免 Key，标记自动 GCJ-02 纠偏）| tianditu（需 Key，无偏移）
 *       | tianditu-satellite | osm
 *
 * 最小配置：
 *   type: custom:ha-cn-map-card
 *   entities:
 *     - person.me
 */

import { HaCnMapCard } from "./card.js";
import { HaCnMapCardEditor } from "./editor.js";

customElements.define("ha-cn-map-card", HaCnMapCard);
customElements.define("ha-cn-map-card-editor", HaCnMapCardEditor);

// 让 HA 识别为 Lovelace 卡片（卡片选择器 / 编辑器占位）
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-cn-map-card",
  name: "中国地图卡片",
  description: "高德/天地图底图的 HA 地图卡片，免代理直连",
  preview: true,
  documentationURL: "https://github.com/RockJesus/ha-map-cn#readme",
});

console.info("%c ha-cn-map-card v1.9.1 ", "background:#e53935;color:#fff;padding:2px 4px;border-radius:3px 0 0 3px", "background:#424242;color:#fff;padding:2px 4px;border-radius:0 3px 3px 0");
