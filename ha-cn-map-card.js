/**
 * ha-cn-map-card v1.1.6 — 国内底图 HA 地图卡片（HACS 自定义卡片）
 *
 * 零依赖、零构建：入口从这里加载，实现拆在 src/ 下——
 *   src/shared.js  共享常量与工具（底图源 / GCJ-02 纠偏 / 布局 / 图标 / 本地存储）
 *   src/engine.js  轻量 XYZ 瓦片引擎（不引 Leaflet）
 *   src/card.js    Lovelace 卡片主类
 *   src/editor.js  可视化编辑器
 *
 * 零依赖：内置轻量 XYZ 瓦片引擎（投影/平移/缩放/标记），不引 Leaflet。
 * 底图：amap（高德，免 Key，标记自动 GCJ-02 纠偏）| tianditu（需 Key，无偏移）
 *       | tianditu-satellite
 *
 * 最小配置：
 *   type: custom:ha-cn-map-card
 *   entities:
 *     - person.me
 */

import { HaCnMapCard } from "./src/card.js";
import { HaCnMapCardEditor } from "./src/editor.js";

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

console.info("%c ha-cn-map-card v1.1.6 ", "background:#e53935;color:#fff;padding:2px 4px;border-radius:3px 0 0 3px", "background:#424242;color:#fff;padding:2px 4px;border-radius:0 3px 3px 0");
