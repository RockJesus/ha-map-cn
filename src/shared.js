/* ---- 共享常量与工具（底图源 / GCJ-02 纠偏 / 布局 / 图标 / 本地存储）---- */

/* ---- GCJ-02 → WGS84（高德底图时把 WGS84 标记投到底图坐标系） ---- */
const GCJ = (() => {
  const a = 6378245.0, ee = 0.00669342162296594;
  const tLat = (x, y) => {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return r;
  };
  const tLng = (x, y) => {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return r;
  };
  return {
    // 返回 [gcjLat, gcjLng]：把 WGS84 坐标挪到高德瓦片上正确的显示位置
    outOfChina: (lat, lng) => lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271,
    wgs2gcj(lat, lng) {
      if (this.outOfChina(lat, lng)) return [lat, lng];
      let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
      const radLat = lat / 180 * Math.PI;
      let magic = Math.sin(radLat);
      magic = 1 - ee * magic * magic;
      const sqrt = Math.sqrt(magic);
      dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrt) * Math.PI);
      dLng = (dLng * 180) / (a / sqrt * Math.cos(radLat) * Math.PI);
      return [lat + dLat, lng + dLng];
    },
  };
})();

/* ---- 运行时设置持久化（浏览器本地，不改 /config/.storage 里的仪表盘 YAML） ---- */
const LS_PREFIX = "ha-cn-map-card:";
// 实体处于这些状态时视为"无有效位置/失联"，标记灰显
const OFFLINE_STATES = new Set(["unavailable", "unknown"]);
// 设置抽屉 / 快捷按钮可写回本地的键
const RUNTIME_KEYS = [
  "basemap",
  "theme_mode",
  "tianditu_key",
  "show_traffic",
  "hours_to_show",
  "show_zones",
  "show_zone_radius",
  "show_labels",
  "label_mode",
  "show_cluster",
  "show_status",
  "show_accuracy",
  "height",
];
// 同一张卡片在多个视图里会被实例化成多个实例；按「仪表盘路径 + 卡片顺序」生成稳定 id
function storageKey(config) {
  const v = config?.view_index ?? 0;
  const i = config?.card_index ?? 0;
  const path = (typeof window !== "undefined" && window.location?.pathname) || "/";
  return `${LS_PREFIX}${path}#v${v}c${i}`;
}
function loadRuntime(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}") || {};
  } catch {
    return {};
  }
}
function saveRuntime(key, opts) {
  try {
    window.localStorage.setItem(key, JSON.stringify(opts));
  } catch {
    /* 隐私模式 / 配额满：忽略 */
  }
}

const CLUSTER_RADIUS_PX = 60;  // 屏幕像素距离内合并
const CLUSTER_MAX_AVATAR = 3;  // 气泡里最多显示几个头像

/* ---- 布局模式（对齐官方 hui-map-card 的 layout 语义） ----
   official：仪表盘把我放在 panel 视图（或全屏）里 → 地图铺满、右下角抽屉面板
   compact ：sections / masonry / grid 里 → 固定高度
   full   ：卡片自己占满视口（fullscreen: true）                              */
const LAYOUT = { OFFICIAL: "official", COMPACT: "compact", FULL: "full" };
// 卡片能拿到的高度（px）；infinity 表示由祖先决定 */
const VIEWPORT_H = () => (typeof window !== "undefined" ? window.innerHeight || 800 : 800);

/* 官方 MDI 图标路径（16 进制），避免额外请求图标字体 */
const ICONS = {
  plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
  minus: "M19,13H5V11H19V13Z",
  focus: "M10,20V14H4V10H10V4H14V10H20V14H14V20H10Z",
  cluster: "M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4Z",
  cog: "M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z",
  traffic: "M20,5H4A2,2 0 0,0 2,7V17A2,2 0 0,0 4,19H20A2,2 0 0,0 22,17V7A2,2 0 0,0 20,5M7,15A2.5,2.5 0 0,1 4.5,12.5A2.5,2.5 0 0,1 7,10A2.5,2.5 0 0,1 9.5,12.5A2.5,2.5 0 0,1 7,15M17,15A2.5,2.5 0 0,1 14.5,12.5A2.5,2.5 0 0,1 17,10A2.5,2.5 0 0,1 19.5,12.5A2.5,2.5 0 0,1 17,15M13,13H11V11H13V13M13,10H11V8H13V10Z",
  chevronLeft: "M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z",
  history: "M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 1,1 13,19C11.07,19 9.36,18.16 8.19,16.85L6.77,18.27A9,9 0 1,0 13,3Z",
  fullscreen: "M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z",
  fullscreenExit: "M5,16H8V19H10V16A2,2 0 0,0 8,14H5V16M16,16V19H14V16A2,2 0 0,1 16,14H19V16H16M10,5V8A2,2 0 0,1 8,10H5V8H8V5H10M14,5H16V8H19V10H16A2,2 0 0,1 14,8V5Z",
  people: "M16,13C15.71,13 15.38,13 15.03,13.05C16.19,13.89 17,15 17,16.5V19H23V16.5C23,14.17 18.33,13 16,13M8,13C5.67,13 1,14.17 1,16.5V19H15V16.5C15,14.17 10.33,13 8,13M8,11C9.66,11 11,9.66 11,8C11,6.34 9.66,5 8,5C6.34,5 5,6.34 5,8C5,9.66 6.34,11 8,11M16,11C17.66,11 19,9.66 19,8C19,6.34 17.66,5 16,5C14.34,5 13,6.34 13,8C13,9.66 14.34,11 16,11Z",
};

/* ---- 底图源 ---- */
const BASEMAPS = {
  amap: {
    name: "高德",
    attribution: "© 高德地图 AutoNavi",
    maxZoom: 18,
    needsShift: true, // 标记需 WGS84→GCJ02
    layers: [
      { template: (x, y, z) => `https://webrd0${(x % 4) + 1}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}` },
    ],
  },
  "amap-satellite": {
    name: "高德卫星",
    attribution: "© 高德地图 AutoNavi",
    maxZoom: 18,
    needsShift: true,
    noFilter: true, // 卫星影像反色会变成"负片"，暗色模式也不套 filter
    layers: [
      { template: (x, y, z) => `https://webst0${(x % 4) + 1}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}` },
      { template: (x, y, z) => `https://webst0${(x % 4) + 1}.is.autonavi.com/appmaptile?style=8&x=${x}&y=${y}&z=${z}`, opacity: 0.9 },
    ],
  },
  tianditu: {
    name: "天地图",
    attribution: "© 国家天地图",
    maxZoom: 18,
    needsShift: false,
    requireKey: true,
    layers: [
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=vec_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=cva_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
    ],
  },
  "tianditu-satellite": {
    name: "天地图卫星",
    attribution: "© 国家天地图",
    maxZoom: 18,
    needsShift: false,
    requireKey: true,
    noFilter: true,
    layers: [
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=img_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=cia_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
    ],
  },
  traffic: {
    name: "实时路况",
    attribution: "© 高德路况",
    maxZoom: 18,
    needsShift: false,
    layers: [
      { template: (x, y, z) =>
          `https://tm.amap.com/trafficengine/mapabc/traffictile?v=1.0&t=1&x=${x}&y=${y}&z=${z}`,
        opacity: 0.9 },
    ],
  },
  osm: {
    name: "OpenStreetMap",
    attribution: "© OpenStreetMap",
    maxZoom: 19,
    needsShift: false,
    layers: [{ template: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` }],
  },
};

/* ---- HTML 转义（列表项直接拼字符串，实体名可能带特殊字符） ---- */
const escapeHtml = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escapeAttr = (v) => escapeHtml(v);

export {
  GCJ, LS_PREFIX, OFFLINE_STATES, RUNTIME_KEYS, storageKey, loadRuntime, saveRuntime,
  CLUSTER_RADIUS_PX, CLUSTER_MAX_AVATAR, LAYOUT, VIEWPORT_H, ICONS, BASEMAPS,
  escapeHtml, escapeAttr,
};
