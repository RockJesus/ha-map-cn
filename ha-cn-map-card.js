// src/shared.js
var GCJ = /* @__PURE__ */ (() => {
  const a = 6378245, ee = 0.00669342162296594;
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
      dLat = dLat * 180 / (a * (1 - ee) / (magic * sqrt) * Math.PI);
      dLng = dLng * 180 / (a / sqrt * Math.cos(radLat) * Math.PI);
      return [lat + dLat, lng + dLng];
    },
    // 反向：把高德底图上的坐标还原成 WGS84（拖动家图标后写回配置用）
    gcj2wgs(lat, lng) {
      if (this.outOfChina(lat, lng)) return [lat, lng];
      let wLat = lat, wLng = lng;
      for (let i = 0; i < 3; i++) {
        const [gLat, gLng] = this.wgs2gcj(wLat, wLng);
        wLat += lat - gLat;
        wLng += lng - gLng;
      }
      return [wLat, wLng];
    }
  };
})();
var LS_PREFIX = "ha-cn-map-card:";
var OFFLINE_STATES = /* @__PURE__ */ new Set(["unavailable", "unknown"]);
var RUNTIME_KEYS = [
  "basemap",
  "theme_mode",
  "tianditu_key",
  "show_traffic",
  "hours_to_show",
  "show_zones",
  "show_zone_radius",
  "show_all",
  "hidden_entities",
  "home_lat",
  "home_lng",
  "home_radius",
  "home_address",
  "amap_key",
  "show_labels",
  "label_mode",
  "show_cluster",
  "show_status",
  "show_accuracy",
  "height"
];
function storageKey(config) {
  const v = config?.view_index ?? 0;
  const i = config?.card_index ?? 0;
  const path = typeof window !== "undefined" && window.location?.pathname || "/";
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
  }
}
var CLUSTER_RADIUS_PX = 60;
var CLUSTER_MAX_AVATAR = 3;
var LAYOUT = { OFFICIAL: "official", COMPACT: "compact", FULL: "full" };
var ICONS = {
  plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
  minus: "M19,13H5V11H19V13Z",
  // 显示全部：与官方地图卡一致的中心对焦图标（四角括号 + 中心点），不再与“放大 +”混淆
  focus: "M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M19,19H15V21H19A2,2 0 0,0 21,19V15H19M19,3H15V5H19V9H21V5A2,2 0 0,0 19,3M5,5H9V3H5A2,2 0 0,0 3,5V9H5M5,15H3V19A2,2 0 0,0 5,21H9V19H5V15Z",
  // 切换分组：与官方地图卡同款（聚合中 = 圈内圆点社区，已拆散 = 六边形点阵）
  cluster: "M15,12C13.89,12 13,12.89 13,14A2,2 0 0,0 15,16A2,2 0 0,0 17,14C17,12.89 16.1,12 15,12M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M14,9C14,7.89 13.1,7 12,7C10.89,7 10,7.89 10,9A2,2 0 0,0 12,11A2,2 0 0,0 14,9M9,12A2,2 0 0,0 7,14A2,2 0 0,0 9,16A2,2 0 0,0 11,14C11,12.89 10.1,12 9,12Z",
  clusterOff: "M16 12C16 10.9 16.9 10 18 10S20 10.9 20 12 19.1 14 18 14 16 13.1 16 12M10 12C10 10.9 10.9 10 12 10S14 10.9 14 12 13.1 14 12 14 10 13.1 10 12M4 12C4 10.9 4.9 10 6 10S8 10.9 8 12 7.1 14 6 14 4 13.1 4 12M13 18C13 16.9 13.9 16 15 16S17 16.9 17 18 16.1 20 15 20 13 19.1 13 18M7 18C7 16.9 7.9 16 9 16S11 16.9 11 18 10.1 20 9 20 7 19.1 7 18M13 6C13 4.9 13.9 4 15 4S17 4.9 17 6 16.1 8 15 8 13 7.1 13 6M7 6C7 4.9 7.9 4 9 4S11 4.9 11 6 10.1 8 9 8 7 7.1 7 6",
  // 重置焦点：准星+GPS 点，区别于「显示全部」的中心对焦方框图标
  resetFocus: "M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8M3.05,13H1V11H3.05C3.5,6.83 6.83,3.5 11,3.05V1H13V3.05C17.17,3.5 20.5,6.83 20.95,11H23V13H20.95C20.5,17.17 17.17,20.5 13,20.95V23H11V20.95C6.83,20.5 3.5,17.17 3.05,13M12,5A7,7 0 0,0 5,12A7,7 0 0,0 12,19A7,7 0 0,0 19,12A7,7 0 0,0 12,5Z",
  cog: "M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z",
  traffic: "M20,5H4A2,2 0 0,0 2,7V17A2,2 0 0,0 4,19H20A2,2 0 0,0 22,17V7A2,2 0 0,0 20,5M7,15A2.5,2.5 0 0,1 4.5,12.5A2.5,2.5 0 0,1 7,10A2.5,2.5 0 0,1 9.5,12.5A2.5,2.5 0 0,1 7,15M17,15A2.5,2.5 0 0,1 14.5,12.5A2.5,2.5 0 0,1 17,10A2.5,2.5 0 0,1 19.5,12.5A2.5,2.5 0 0,1 17,15M13,13H11V11H13V13M13,10H11V8H13V10Z",
  chevronLeft: "M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z",
  nav: "M12,2L4.5,20.29L5.21,21L12,18L18.79,21L19.5,20.29L12,2Z",
  history: "M13.5,8H12V13L16.28,15.54L17,14.33L13.5,12.25V8M13,3A9,9 0 0,0 4,12H1L4.96,16.03L9,12H6A7,7 0 1,1 13,19C11.07,19 9.36,18.16 8.19,16.85L6.77,18.27A9,9 0 1,0 13,3Z",
  fullscreen: "M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z",
  fullscreenExit: "M5,16H8V19H10V16A2,2 0 0,0 8,14H5V16M16,16V19H14V16A2,2 0 0,1 16,14H19V16H16M10,5V8A2,2 0 0,1 8,10H5V8H8V5H10M14,5H16V8H19V10H16A2,2 0 0,1 14,8V5Z",
  people: "M16,13C15.71,13 15.38,13 15.03,13.05C16.19,13.89 17,15 17,16.5V19H23V16.5C23,14.17 18.33,13 16,13M8,13C5.67,13 1,14.17 1,16.5V19H15V16.5C15,14.17 10.33,13 8,13M8,11C9.66,11 11,9.66 11,8C11,6.34 9.66,5 8,5C6.34,5 5,6.34 5,8C5,9.66 6.34,11 8,11M16,11C17.66,11 19,9.66 19,8C19,6.34 17.66,5 16,5C14.34,5 13,6.34 13,8C13,9.66 14.34,11 16,11Z",
  lock: "M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10A2,2 0 0,1 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z",
  lockOpen: "M12,17A2,2 0 0,0 14,15C14,13.89 13.1,13 12,13A2,2 0 0,0 10,15A2,2 0 0,0 12,17M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10A2,2 0 0,1 6,8H7V6A5,5 0 0,1 17.71,3.71L16.3,5.12A3,3 0 0,0 9,6V8H18V10H6V20H18V10H20V8H18Z"
};
var BASEMAPS = {
  amap: {
    name: "高德",
    attribution: "© 高德地图 AutoNavi",
    maxZoom: 18,
    needsShift: true,
    // 标记需 WGS84→GCJ02
    layers: [
      { template: (x, y, z) => `https://webrd0${x % 4 + 1}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=${x}&y=${y}&z=${z}` }
    ]
  },
  "amap-satellite": {
    name: "高德卫星",
    attribution: "© 高德地图 AutoNavi",
    maxZoom: 18,
    needsShift: true,
    noFilter: true,
    // 卫星影像反色会变成"负片"，暗色模式也不套 filter
    layers: [
      { template: (x, y, z) => `https://webst0${x % 4 + 1}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}` },
      { template: (x, y, z) => `https://webst0${x % 4 + 1}.is.autonavi.com/appmaptile?style=8&x=${x}&y=${y}&z=${z}`, opacity: 0.9 }
    ]
  },
  tianditu: {
    name: "天地图",
    attribution: "© 国家天地图",
    maxZoom: 18,
    needsShift: false,
    requireKey: true,
    layers: [
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=vec_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=cva_w&x=${x}&y=${y}&l=${z}&tk=${tk}` }
    ]
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
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=cia_w&x=${x}&y=${y}&l=${z}&tk=${tk}` }
    ]
  },
  traffic: {
    name: "实时路况",
    attribution: "© 高德路况",
    maxZoom: 18,
    needsShift: false,
    layers: [
      {
        template: (x, y, z) => `https://tm.amap.com/trafficengine/mapabc/traffictile?v=1.0&t=1&x=${x}&y=${y}&z=${z}`,
        opacity: 0.9
      }
    ]
  },
  osm: {
    name: "OpenStreetMap",
    attribution: "© OpenStreetMap",
    maxZoom: 19,
    needsShift: false,
    layers: [{ template: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` }]
  }
};
var escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var escapeAttr = (v) => escapeHtml(v);

// src/engine.js
var CnTileEngine = class _CnTileEngine extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.viewport = document.createElement("div");
    this.viewport.className = "cmc-viewport";
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "cmc-labels";
    this.markerLayer = document.createElement("div");
    this.markerLayer.className = "cmc-markers";
    this.pathLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.pathLayer.classList.add("cmc-paths");
    this.pathLayer.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:hidden";
    this.pathLayer.setAttribute("preserveAspectRatio", "none");
    this._pathGroups = /* @__PURE__ */ new Map();
    this._hitGroup = null;
    this.onTrackHover = null;
    this._paths = [];
    this.clusterLayer = document.createElement("div");
    this.clusterLayer.className = "cmc-clusters";
    this.attribution = document.createElement("div");
    this.attribution.className = "cmc-attribution";
    this.viewport.style.position = "absolute";
    this.viewport.style.inset = "0";
    this.viewport.style.zIndex = "1";
    this.labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    this.markerLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5";
    this.clusterLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6";
    this.attribution.style.cssText = "position:absolute;right:4px;bottom:2px;font-size:10px;opacity:.6;pointer-events:none;color:var(--primary-text-color,#eee)";
    this.scaleEl = null;
    container.appendChild(this.viewport);
    container.appendChild(this.pathLayer);
    container.appendChild(this.labelLayer);
    container.appendChild(this.markerLayer);
    container.appendChild(this.clusterLayer);
    container.appendChild(this.attribution);
    this.zoom = 12;
    this.center = { lat: 39.9042, lng: 116.4074 };
    this.tileSets = [];
    this._tileSeq = 0;
    this._attachGestures();
  }
  /* ---- Web Mercator ---- */
  static project(lat, lng) {
    const clamp = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = clamp * Math.PI / 180;
    const s = Math.sin(rad);
    return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
  }
  static tileXY(lat, lng, z) {
    const p = _CnTileEngine.project(lat, lng);
    const n = 2 ** z;
    return { x: p.x * n, y: p.y * n };
  }
  /* 屏幕坐标（clientX/clientY）→ 底图坐标系经纬度（拖动家图标用） */
  latLngAt(clientX, clientY) {
    const r = this.container.getBoundingClientRect();
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = _CnTileEngine.project(this.center.lat, this.center.lng);
    const n = 2 ** this.zoom;
    const wx = c.x + (clientX - r.left - w / 2) / (n * 256);
    const wy = c.y + (clientY - r.top - h / 2) / (n * 256);
    const lng = wx * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI;
    return { lat, lng };
  }
  setView(lat, lng, zoom) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (zoom != null && !Number.isFinite(zoom)) zoom = null;
    this.center = { lat, lng };
    if (zoom != null) this.zoom = zoom;
    this.render();
  }
  /* 平滑飞行：官方点击标记 / 点击列表项时地图以动画平移+缩放到目标。
     线性插值 zoom（对数尺度视觉上更匀），经纬度按已走进度插值；
     期间用户任何手势立即接管（取消动画），避免"抢方向盘"的手感 */
  flyTo(lat, lng, zoom, duration = 550, opts = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (zoom != null && !Number.isFinite(zoom)) zoom = null;
    if (typeof window === "undefined" || !window.requestAnimationFrame) {
      this.setView(lat, lng, zoom);
      return;
    }
    const from = { lat: this.center.lat, lng: this.center.lng, z: this.zoom };
    if (!Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(from.z)) {
      this.setView(lat, lng, zoom ?? 12);
      return;
    }
    const toZ = Math.max(3, Math.min(18, zoom ?? this.zoom));
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = _CnTileEngine.tileXY(from.lat, from.lng, from.z);
    const p = _CnTileEngine.project(lat, lng);
    const n = 2 ** from.z;
    const px = (p.x - c.x) * n * 256 + w / 2;
    const py = (p.y - c.y) * n * 256 + h / 2;
    const targetZ = opts.forceZoom ? toZ : px > 40 && px < w - 40 && py > 60 && py < h - 40 ? from.z : toZ;
    if (targetZ === from.z && Math.hypot(px - w / 2, py - h / 2) < 2) return;
    const t0 = performance.now();
    this._fly?.cancel?.();
    let raf = 0;
    const ease = (t) => t < 0.5 ? 2 * t * t : 1 - (1 - t) * (2 - 2 * t);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      const e = ease(k);
      this.center = { lat: from.lat + (lat - from.lat) * e, lng: from.lng + (lng - from.lng) * e };
      this.zoom = Math.round((from.z + (targetZ - from.z) * e) * 100) / 100;
      this.render();
      if (k < 1 && !this._fly?.cancelled) raf = requestAnimationFrame(step);
      else this._fly = null;
    };
    this._fly = { cancelled: false, cancel: () => {
      this._fly.cancelled = true;
      cancelAnimationFrame(raf);
    } };
    raf = requestAnimationFrame(step);
  }
  addTileSet({ url, maxZoom = 18, zIndex = 1, opacity = 1, attribution = "", nofilter = false }) {
    const ts = { url, maxZoom, zIndex, opacity, els: /* @__PURE__ */ new Map(), id: ++this._tileSeq };
    const layer = document.createElement("div");
    layer.className = nofilter ? "cmc-layer cmc-nofilter" : "cmc-layer";
    layer.style.cssText = `position:absolute;inset:0;z-index:${zIndex};opacity:${opacity}`;
    ts.layer = layer;
    this.viewport.appendChild(layer);
    this.tileSets.push(ts);
    this.attribution.innerHTML = attribution;
    return ts;
  }
  removeTileSets() {
    this.tileSets.forEach((t) => t.layer.remove());
    this.tileSets = [];
  }
  /* 叠加层（如实时路况）：独立于底图，移除时不影响底图 */
  setOverlay(id, spec) {
    this._overlays = this._overlays || /* @__PURE__ */ new Map();
    const old = this._overlays.get(id);
    if (old) {
      old.tileSets.forEach((t) => t.layer.remove());
      this.tileSets = this.tileSets.filter((t) => !old.tileSets.includes(t));
      old.tileSets.forEach((t) => {
        t.els.forEach((i) => i.remove());
      });
      this._overlays.delete(id);
    }
    if (!spec) return;
    const sets = spec.layers.map((l, i) => {
      const ts = this.addTileSet({
        url: l.template,
        maxZoom: spec.maxZoom || 18,
        opacity: l.opacity ?? 1,
        zIndex: 20 + i,
        nofilter: true
      });
      return ts;
    });
    this._overlays.set(id, { tileSets: sets });
    this.render();
  }
  render() {
    if (!this.container.clientWidth || !this.container.clientHeight) this._scheduleRenderRetry();
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = _CnTileEngine.tileXY(this.center.lat, this.center.lng, this.zoom);
    this.tileSets.forEach((ts) => {
      const z = Math.min(Math.floor(this.zoom), ts.maxZoom);
      const scale = 2 ** (this.zoom - z);
      const n = 2 ** z;
      const cz = 2 ** (this.zoom - z);
      const cxz = c.x / cz, cyz = c.y / cz;
      const half = Math.max(w, h) / 256 * (1 / scale) / 2 + 3;
      const tx0 = Math.floor(cxz - half);
      const tx1 = Math.ceil(cxz + half);
      const ty0 = Math.floor(cyz - half);
      const ty1 = Math.ceil(cyz + half);
      const keep = /* @__PURE__ */ new Set();
      const midX = (tx0 + tx1) / 2;
      const midY = (ty0 + ty1) / 2;
      const diag = Math.max(1, Math.hypot(tx1 - tx0, ty1 - ty0) / 2);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (ty < 0 || ty >= n) continue;
          const wx = (tx % n + n) % n;
          const key = `${z}/${wx}/${ty}`;
          keep.add(key);
          let img = ts.els.get(key);
          if (!img) {
            img = document.createElement("img");
            img.className = "cmc-tile";
            img.loading = "eager";
            img.decoding = "async";
            img.style.cssText = "position:absolute;width:256px;height:256px;user-select:none;-webkit-user-drag:none;image-rendering:auto";
            img.src = ts.url(wx, ty, z);
            img.referrerPolicy = "no-referrer";
            img.onerror = () => {
              img.style.visibility = "hidden";
            };
            const d = Math.hypot(tx - midX, ty - midY) / diag;
            if (d < 0.4) {
              try {
                img.fetchPriority = "high";
              } catch (_e) {
              }
            } else if (d > 0.8) {
              try {
                img.fetchPriority = "low";
              } catch (_e) {
              }
            }
            ts.els.set(key, img);
            ts.layer.appendChild(img);
          }
          img.style.visibility = "visible";
          const px = (tx - cxz) * 256 * scale + w / 2;
          const py = (ty - cyz) * 256 * scale + h / 2;
          img.style.left = `${px}px`;
          img.style.top = `${py}px`;
          const size = 256 * scale;
          img.style.width = `${size}px`;
          img.style.height = `${size}px`;
        }
      }
      const now = Date.now();
      ts.els.forEach((img, key) => {
        if (keep.has(key)) {
          img.__lastSeen = now;
          return;
        }
        if (!img.__lastSeen) img.__lastSeen = now - 6e3;
        if (now - img.__lastSeen > 5e3) {
          img.remove();
          ts.els.delete(key);
        } else {
          img.style.visibility = "hidden";
        }
      });
    });
    this._layoutMarkers(w, h);
    this._layoutPaths(w, h);
    this._layoutCircles();
    this._updateScale(w);
  }
  /* 容器还没有尺寸时（0×0，常见于刚挂载/切视图），等下一帧再画 */
  _scheduleRenderRetry() {
    if (this._retryTimer) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this.container.isConnected) return;
      if (this.container.clientWidth > 0 && this.container.clientHeight > 0) this.render();
    }, 120);
  }
  /* 比例尺：取一个整齐的距离，换算成屏幕像素宽度 */
  _updateScale(w) {
    if (!this.scaleEl) return;
    if (!Number.isFinite(this.zoom) || !Number.isFinite(this.center.lat)) return;
    const lat = this.center.lat;
    const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** this.zoom;
    if (!Number.isFinite(mPerPx) || mPerPx <= 0) return;
    const targetPx = Math.min(120, w * 0.28);
    const rawM = mPerPx * targetPx;
    const pow = 10 ** Math.floor(Math.log10(rawM));
    const norm = rawM / pow;
    const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    const meters = nice * pow;
    const px = meters / mPerPx;
    this.scaleEl.style.width = `${Math.round(px)}px`;
    this.scaleEl.textContent = meters >= 1e3 ? `${meters / 1e3} km` : `${meters} m`;
  }
  /* ---- 标记 ---- */
  setMarkers(markers, opts) {
    this._markers = markers;
    (this._markerEls || []).forEach((el) => el.classList.remove("is-selected"));
    this._selectedEntity = null;
    this._clusterOn = !!opts?.cluster;
    this.markerLayer.innerHTML = "";
    this.labelLayer.innerHTML = "";
    this._markerEls = markers.map((m) => {
      const el = document.createElement("div");
      el.className = "cmc-marker";
      el.style.cssText = "position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;text-align:center";
      if (m.home) {
        const hm = document.createElement("div");
        hm.className = "cmc-home";
        const hic = document.createElement("ha-icon");
        hic.setAttribute("icon", m.icon || "mdi:home");
        hm.appendChild(hic);
        el.appendChild(hm);
        if (m.label) {
          const lb = document.createElement("div");
          lb.className = "cmc-label";
          lb.textContent = m.label;
          el.appendChild(lb);
        }
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          if (el.dataset.dragged === "1" || Date.now() < (this._suppressClickUntil || 0)) {
            el.dataset.dragged = "";
            return;
          }
          this.dispatchEvent(new CustomEvent("marker-click", { detail: { entityId: m.entityId } }));
        });
        this._attachMarkerDrag(el, m);
        this.markerLayer.appendChild(el);
        return el;
      }
      if (m.picture) {
        const img = document.createElement("img");
        img.src = m.picture;
        img.referrerPolicy = "no-referrer";
        img.alt = "";
        el.appendChild(img);
      } else {
        const fb = document.createElement("div");
        fb.className = "cmc-fallback";
        if (m.color) fb.style.background = m.color;
        const ic = document.createElement("ha-icon");
        ic.setAttribute("icon", m.icon || "mdi:map-marker");
        fb.appendChild(ic);
        el.appendChild(fb);
      }
      if (m.label) {
        const lb = document.createElement("div");
        lb.className = "cmc-label";
        lb.textContent = m.label;
        if (m.offline) {
          el.classList.add("is-offline");
          lb.style.opacity = ".55";
          el.title = `${m.label}（离线）`;
        }
        el.appendChild(lb);
        if (m.sub) {
          const sb = document.createElement("div");
          sb.className = "cmc-label cmc-label-sub";
          sb.textContent = m.sub;
          el.appendChild(sb);
        }
      }
      if (m.entityId) {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          this.dispatchEvent(new CustomEvent("marker-click", { detail: { entityId: m.entityId } }));
        });
      }
      this.markerLayer.appendChild(el);
      return el;
    });
    if (this._selectedEntity) {
      const idx = this._markers.findIndex((m) => m.entityId === this._selectedEntity);
      if (idx >= 0) this._markerEls[idx]?.classList.add("is-selected");
      else this._selectedEntity = null;
    }
    this._layoutMarkers();
  }
  /* 选中 / 取消选中实体：官方聚焦语义，标记加光环 */
  setSelected(entityId) {
    this._selectedEntity = entityId || null;
    (this._markerEls || []).forEach((el, i) => {
      el.classList.toggle("is-selected", !!entityId && this._markers?.[i]?.entityId === entityId);
    });
  }
  /* ---- 轨迹 ---- */
  setPaths(paths) {
    this._paths = paths || [];
    const keep = /* @__PURE__ */ new Set();
    this._paths.forEach((p) => {
      let el = this._pathGroups.get(p.entityId);
      if (!el) {
        el = document.createElementNS("http://www.w3.org/2000/svg", "path");
        el.setAttribute("fill", "none");
        el.setAttribute("stroke-linecap", "round");
        el.setAttribute("stroke-linejoin", "round");
        el.setAttribute("vector-effect", "non-scaling-stroke");
        this.pathLayer.appendChild(el);
        this._pathGroups.set(p.entityId, el);
      }
      el.setAttribute("stroke", p.color);
      el.setAttribute("stroke-width", String(p.width || 3));
      el.setAttribute("opacity", String(p.opacity ?? 0.85));
      if (p.dashed) el.setAttribute("stroke-dasharray", "6 5");
      else el.removeAttribute("stroke-dasharray");
      keep.add(p.entityId);
    });
    this._pathGroups.forEach((el, id) => {
      if (!keep.has(id)) {
        el.remove();
        this._pathGroups.delete(id);
      }
    });
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    this._layoutPaths(w, h);
  }
  /* ---- 精度圈：官方按 gps_accuracy 画的半透明圆（WGS84 半径，米） ---- */
  setAccuracyCircles(circles) {
    this._accCircles = circles || [];
    this._layoutCircles();
  }
  _layoutCircles() {
    this._circleGroup?.remove();
    const list = this._accCircles;
    if (!list || !list.length) return;
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = _CnTileEngine.project(this.center.lat, this.center.lng);
    const n = 2 ** this.zoom;
    const group = this._circleGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.pathLayer.appendChild(group);
    for (const ci of list) {
      if (!Number.isFinite(ci.lat) || !Number.isFinite(ci.lng) || !Number.isFinite(ci.radius)) continue;
      const q = _CnTileEngine.project(ci.lat, ci.lng);
      const x = (q.x - c.x) * n * 256 + w / 2;
      const y = (q.y - c.y) * n * 256 + h / 2;
      const mPerPx = 156543.03392 * Math.cos(ci.lat * Math.PI / 180) / n;
      const r = ci.radius / mPerPx;
      const drawCircle = Number.isFinite(r) && r >= 2 && r <= Math.max(w, h) * 3;
      if (drawCircle) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        el.setAttribute("cx", x.toFixed(1));
        el.setAttribute("cy", y.toFixed(1));
        el.setAttribute("r", r.toFixed(1));
        el.setAttribute("fill", ci.color || "#03a9f4");
        el.setAttribute("fill-opacity", String(ci.fillOpacity ?? 0.1));
        el.setAttribute("stroke", ci.color || "#03a9f4");
        el.setAttribute("stroke-opacity", String(ci.strokeOpacity ?? 0.3));
        el.setAttribute("stroke-width", String(ci.strokeWidth ?? 1.5));
        if (ci.dashed) el.setAttribute("stroke-dasharray", "5 4");
        group.appendChild(el);
      }
      if (ci.handle) {
        const hx = drawCircle ? x + r : x + 22;
        const hy = y;
        const hd = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hd.setAttribute("cx", hx.toFixed(1));
        hd.setAttribute("cy", hy.toFixed(1));
        hd.setAttribute("r", "7");
        hd.setAttribute("fill", "#fff");
        hd.setAttribute("stroke", ci.color || "#03a9f4");
        hd.setAttribute("stroke-width", "2");
        hd.setAttribute("style", "cursor:ew-resize;pointer-events:all");
        hd.setAttribute("class", "cmc-radius-handle");
        group.appendChild(hd);
        const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hit.setAttribute("cx", hx.toFixed(1));
        hit.setAttribute("cy", hy.toFixed(1));
        hit.setAttribute("r", "18");
        hit.setAttribute("fill", "rgba(0,0,0,0)");
        hit.setAttribute("style", "pointer-events:all");
        group.appendChild(hit);
        this._attachRadiusHandle(hd, hit, ci, x, y, mPerPx);
      }
    }
  }
  clearPaths() {
    this._pathGroups.forEach((el) => el.remove());
    this._pathGroups.clear();
    this._paths = [];
  }
  _layoutPaths(w, h) {
    if (!this._paths.length) {
      this._arrowGroup?.remove();
      this._hitGroup?.remove();
      this._hitGroup = null;
      return;
    }
    const c = _CnTileEngine.project(this.center.lat, this.center.lng);
    const n = 2 ** this.zoom;
    const margin = 4e3;
    this._arrowGroup?.remove();
    const arrowGroup = this._arrowGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.pathLayer.appendChild(arrowGroup);
    this._hitGroup?.remove();
    this._hitGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.pathLayer.appendChild(this._hitGroup);
    const SPACING = 90, ARROW = 7;
    this._paths.forEach((p) => {
      const el = this._pathGroups.get(p.entityId);
      if (!el) return;
      let d = "";
      let drawing = false;
      const screen = [];
      for (const pt of p.points) {
        const q = _CnTileEngine.project(pt.lat, pt.lng);
        const x = (q.x - c.x) * n * 256 + w / 2;
        const y = (q.y - c.y) * n * 256 + h / 2;
        if (x < -margin || x > w + margin || y < -margin || y > h + margin) {
          drawing = false;
          screen.length = 0;
          continue;
        }
        screen.push({ x, y, t: pt.t });
        d += `${drawing ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        drawing = true;
      }
      el.setAttribute("d", d);
      if (screen.some((q) => q.t != null)) {
        let lx = -1e9, ly = -1e9, made = 0;
        for (const q of screen) {
          if (q.t == null) continue;
          if (Math.hypot(q.x - lx, q.y - ly) < 14) continue;
          if (made >= 80) break;
          lx = q.x;
          ly = q.y;
          made++;
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("cx", q.x.toFixed(1));
          dot.setAttribute("cy", q.y.toFixed(1));
          dot.setAttribute("r", "7");
          dot.setAttribute("fill", "transparent");
          dot.setAttribute("style", "pointer-events:all");
          const when = q.t;
          dot.addEventListener("mouseenter", (e) => this.onTrackHover?.({ x: e.clientX, y: e.clientY, t: when, entityId: p.entityId, color: p.color }));
          dot.addEventListener("mouseleave", () => this.onTrackHover?.(null));
          this._hitGroup.appendChild(dot);
        }
      }
      if (screen.length < 2) return;
      const segs = [];
      let total = 0;
      for (let i = 1; i < screen.length; i++) {
        const len = Math.hypot(screen[i].x - screen[i - 1].x, screen[i].y - screen[i - 1].y);
        if (len > 0.5) {
          segs.push({ a: screen[i - 1], b: screen[i], len });
          total += len;
        }
      }
      if (total < SPACING) return;
      let placed = 0;
      for (const _seg of segs) {
        while (placed + SPACING / 2 < total) {
          const target = placed + SPACING / 2;
          let acc = 0, seg = null, t = 0;
          for (const sg of segs) {
            if (acc + sg.len >= target) {
              seg = sg;
              t = (target - acc) / sg.len;
              break;
            }
            acc += sg.len;
          }
          if (!seg) break;
          const x = seg.a.x + (seg.b.x - seg.a.x) * t;
          const y = seg.a.y + (seg.b.y - seg.a.y) * t;
          const ang = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x) * 180 / Math.PI;
          const tri = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          tri.setAttribute("points", `${ARROW},0 ${-ARROW * 0.7},${-ARROW * 0.8} ${-ARROW * 0.7},${ARROW * 0.8}`);
          tri.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
          tri.setAttribute("fill", p.color);
          tri.setAttribute("stroke", "rgba(255,255,255,.85)");
          tri.setAttribute("stroke-width", "1");
          tri.setAttribute("opacity", String(Math.min(1, (p.opacity ?? 0.85) + 0.1)));
          arrowGroup.appendChild(tri);
          placed += SPACING;
          if (placed >= total) break;
        }
        break;
      }
    });
  }
  _layoutMarkers(w, h) {
    if (!this._markers || !this._markerEls) return;
    w = w || this.container.clientWidth || 400;
    h = h || this.container.clientHeight || 300;
    this._vw = w;
    this._vh = h;
    const c = _CnTileEngine.project(this.center.lat, this.center.lng);
    const n = 2 ** this.zoom;
    const screen = [];
    this._markers.forEach((m, i) => {
      const p = _CnTileEngine.project(m.lat, m.lng);
      const px = (p.x - c.x) * n * 256 + w / 2;
      const py = (p.y - c.y) * n * 256 + h / 2;
      const el = this._markerEls[i];
      const offscreen = px < -60 || px > w + 60 || py < -80 || py > h + 60;
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      el.style.display = offscreen ? "none" : "";
      el.style.visibility = "";
      screen.push({ marker: m, el, x: px, y: py, offscreen });
    });
    this._applyClusters(screen);
  }
  /* 贪心聚类：屏幕像素距离 <= CLUSTER_RADIUS_PX 的标记归为一组，单成员组不聚合 */
  _applyClusters(screen) {
    this.clusterLayer.innerHTML = "";
    if (!this._clusterOn) return;
    const groups = [];
    for (const entry of screen) {
      if (entry.offscreen || !entry.marker.clusterable) continue;
      let joined = false;
      for (const g of groups) {
        const dx = g.x - entry.x;
        const dy = g.y - entry.y;
        if (Math.hypot(dx, dy) <= CLUSTER_RADIUS_PX) {
          g.members.push(entry);
          const k = g.members.length;
          g.x = (g.x * (k - 1) + entry.x) / k;
          g.y = (g.y * (k - 1) + entry.y) / k;
          joined = true;
          break;
        }
      }
      if (!joined) groups.push({ members: [entry], x: entry.x, y: entry.y });
    }
    this._clusters = [];
    for (const g of groups) {
      if (g.members.length < 2) continue;
      if (g.x < 0 || g.x > this._vw || g.y < 0 || g.y > this._vh) continue;
      g.members.forEach((m) => m.el.style.visibility = "hidden");
      const bubble = this._createClusterEl(g);
      bubble.style.left = `${g.x}px`;
      bubble.style.top = `${g.y}px`;
      this.clusterLayer.appendChild(bubble);
      this._clusters.push({ x: g.x, y: g.y, members: g.members.map((m) => m.marker) });
    }
  }
  /* 区域图标拖动（仅 zone.home）：必须长按 350ms 才进入可拖状态，防止误触。
     拖动期间只更新内存坐标，松手由卡片落盘 */
  _attachMarkerDrag(el, m) {
    if (!m.draggable) return;
    el.style.cursor = "grab";
    const LONG_PRESS = 180;
    let armTimer = null;
    let armed = false;
    let startPt = { x: 0, y: 0 };
    const clearArm = () => {
      if (armTimer) {
        clearTimeout(armTimer);
        armTimer = null;
      }
      armed = false;
      el.classList.remove("cmc-armed");
    };
    const move = (e) => {
      if (!armed) {
        if (Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > 8) clearArm();
        return;
      }
      if (!this._dragMarker) return;
      const ll = this.latLngAt(e.clientX, e.clientY);
      if (!ll) return;
      m.lat = ll.lat;
      m.lng = ll.lng;
      if (el.isConnected) {
        const r = this.container.getBoundingClientRect();
        el.style.left = `${(e.clientX - r.left).toFixed(1)}px`;
        el.style.top = `${(e.clientY - r.top).toFixed(1)}px`;
      }
      if (!this._dragMoved && Math.hypot(e.clientX - this._dragStart.x, e.clientY - this._dragStart.y) > 4) {
        this._dragMoved = true;
        el.dataset.dragged = "1";
      }
      const circ = (this._accCircles || []).find((c) => c.entityId === m.entityId);
      if (circ) {
        circ.lat = ll.lat;
        circ.lng = ll.lng;
        this._layoutCircles();
      }
      this.dispatchEvent(new CustomEvent("marker-drag", { detail: { entityId: m.entityId, lat: ll.lat, lng: ll.lng, phase: "move" } }));
    };
    const end = (e) => {
      clearArm();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (this._suspendedPointers) this._suspendedPointers.delete(e?.pointerId);
      try {
        this.container.releasePointerCapture(e?.pointerId);
      } catch {
      }
      if (!this._dragMarker) return;
      this._dragMarker = null;
      el.style.cursor = "grab";
      if (this._dragMoved) this._suppressClickUntil = Date.now() + 400;
      this.dispatchEvent(new CustomEvent("marker-drag", { detail: { entityId: m.entityId, lat: m.lat, lng: m.lng, phase: "end" } }));
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      armed = false;
      this._dragMoved = false;
      startPt = { x: e.clientX, y: e.clientY };
      this._fly?.cancel?.();
      this._fly = null;
      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      armTimer = setTimeout(() => {
        if (this._homeLocked) return;
        armed = true;
        this._dragMarker = m.entityId;
        this._dragMoved = false;
        this._dragStart = { x: startPt.x, y: startPt.y };
        el.style.cursor = "grabbing";
        el.classList.add("cmc-armed");
        if (this._suspendedPointers) this._suspendedPointers.add(e.pointerId);
        this._releaseGesturePointer?.(e.pointerId);
        try {
          this.container.releasePointerCapture(e.pointerId);
        } catch {
        }
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
        }
        this.dispatchEvent(new CustomEvent("marker-drag", { detail: { entityId: m.entityId, phase: "start" } }));
      }, LONG_PRESS);
    });
  }
  /* 半径手柄拖动：必须长按 350ms 才进入可拖状态，防止误触。
     跟着指针到圆心的距离算米数，实时改圆，松手由卡片落盘 */
  _attachRadiusHandle(handle, hitEl, ci, cx, cy, mPerPx0) {
    const LONG_PRESS = 180;
    let active = false;
    let armed = false;
    let armTimer = null;
    let startPt = { x: 0, y: 0 };
    const clearArm = () => {
      if (armTimer) {
        clearTimeout(armTimer);
        armTimer = null;
      }
      armed = false;
      handle.classList.remove("cmc-armed");
    };
    const move = (e) => {
      if (!armed) {
        if (Math.hypot(e.clientX - startPt.x, e.clientY - startPt.y) > 8) clearArm();
        return;
      }
      if (!active) return;
      const r = this.container.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const mPerPx = mPerPx0 || 156543.03392 * Math.cos(ci.lat * Math.PI / 180) / 2 ** this.zoom;
      const meters = Math.max(20, Math.round(Math.hypot(px - cx, py - cy) * mPerPx));
      if (!Number.isFinite(meters)) return;
      ci.radius = meters;
      const newR = meters / mPerPx;
      if (Number.isFinite(newR) && newR >= 2) {
        const parent = handle.parentNode;
        if (parent) {
          for (const child of parent.children) {
            if (child.tagName === "circle" && child !== handle && child !== hitEl && child.getAttribute("fill") === (ci.color || "#03a9f4")) {
              child.setAttribute("r", newR.toFixed(1));
              break;
            }
          }
        }
      }
      handle.setAttribute("cx", (cx + newR).toFixed(1));
      hitEl.setAttribute("cx", (cx + newR).toFixed(1));
      this.dispatchEvent(new CustomEvent("circle-radius", { detail: { entityId: ci.entityId, radius: meters, phase: "move" } }));
    };
    const end = (e) => {
      clearArm();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (this._suspendedPointers) this._suspendedPointers.delete(e?.pointerId);
      try {
        this.container.releasePointerCapture(e?.pointerId);
      } catch {
      }
      if (!active) return;
      active = false;
      this.dispatchEvent(new CustomEvent("circle-radius", { detail: { entityId: ci.entityId, radius: ci.radius, phase: "end" } }));
    };
    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      armed = false;
      active = false;
      startPt = { x: e.clientX, y: e.clientY };
      this._fly?.cancel?.();
      this._fly = null;
      window.addEventListener("pointermove", move, { passive: true });
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      armTimer = setTimeout(() => {
        if (this._homeLocked) return;
        armed = true;
        active = true;
        handle.classList.add("cmc-armed");
        if (this._suspendedPointers) this._suspendedPointers.add(e.pointerId);
        this._releaseGesturePointer?.(e.pointerId);
        try {
          this.container.releasePointerCapture(e.pointerId);
        } catch {
        }
        try {
          hitEl.setPointerCapture(e.pointerId);
        } catch {
        }
        this.dispatchEvent(new CustomEvent("circle-radius", { detail: { entityId: ci.entityId, radius: ci.radius, phase: "start" } }));
      }, LONG_PRESS);
    };
    handle.addEventListener("pointerdown", onDown);
    hitEl.addEventListener("pointerdown", onDown);
  }
  _createClusterEl(g) {
    const el = document.createElement("div");
    el.className = "cmc-cluster";
    el.style.cssText = "position:absolute;transform:translate(-50%,-130%);pointer-events:auto;cursor:pointer;display:flex;align-items:center;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));";
    const shown = g.members.slice(0, CLUSTER_MAX_AVATAR);
    const useCount = g.members.every((m) => !m.marker.picture && !(m.marker.short || "").trim());
    if (useCount) {
      const c0 = document.createElement("div");
      c0.className = "cmc-cluster-count";
      c0.style.minWidth = "36px";
      c0.style.height = "36px";
      c0.style.borderRadius = "18px";
      c0.style.fontSize = "13px";
      c0.textContent = String(g.members.length);
      el.appendChild(c0);
    } else {
      shown.forEach((m, i) => {
        const a = document.createElement("div");
        a.className = "cmc-cluster-avatar";
        a.style.borderColor = m.marker.color || "#58a6f0";
        if (i) a.style.marginLeft = "-8px";
        const pic = m.marker.picture;
        if (pic) {
          const img = document.createElement("img");
          img.src = pic;
          img.referrerPolicy = "no-referrer";
          img.style.cssText = "width:100%;height:100%;border-radius:50%;object-fit:cover";
          a.appendChild(img);
        } else {
          a.textContent = (m.marker.short || "").slice(0, 1) || "•";
        }
        el.appendChild(a);
      });
      const extra = g.members.length - shown.length;
      if (extra > 0) {
        const c = document.createElement("div");
        c.className = "cmc-cluster-count";
        c.style.marginLeft = "-6px";
        c.textContent = `+${extra}`;
        el.appendChild(c);
      }
    }
    el.title = g.members.map((m) => m.marker.short).join("、");
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.dispatchEvent(
        new CustomEvent("cluster-click", {
          detail: { entityIds: g.members.map((m) => m.marker.entityId).filter(Boolean), count: g.members.length }
        })
      );
      this._userMoved = true;
      this.setZoom(Math.min(this.zoom + 2, 17), { anchor: { x: g.x, y: g.y } });
    });
    return el;
  }
  /* ---- 交互 ---- */
  _attachGestures() {
    const pts = /* @__PURE__ */ new Map();
    let pinchD0 = 0, pinchZ0 = 0, pinchMoved = false;
    const el = this.container;
    el.style.touchAction = "none";
    this._suspendedPointers = this._suspendedPointers || /* @__PURE__ */ new Set();
    el.addEventListener("click", (e) => {
      if (e.target === el || e.target.classList?.contains("cmc-viewport") || e.target.tagName === "IMG") {
        if (this._selectedEntity) {
          this.setSelected(null);
          this.dispatchEvent(new CustomEvent("selection-cleared"));
        }
      }
    });
    const panBy = (dx, dy) => {
      this._userMoved = true;
      const c = _CnTileEngine.tileXY(this.center.lat, this.center.lng, this.zoom);
      const n = 2 ** this.zoom;
      const lng = (c.x * 256 - dx) / 256 / n * 360 - 180;
      const my = (c.y * 256 - dy) / 256 / n;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180 / Math.PI;
      this.setView(lat, lng);
    };
    const anchorAt = (clientX, clientY) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    el.addEventListener("pointerdown", (e) => {
      this._fly?.cancel?.();
      this._fly = null;
      if (this._suspendedPointers.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
      }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
        pinchZ0 = this.zoom;
        pinchMoved = false;
      }
    });
    this._releaseGesturePointer = (id) => {
      pts.delete(id);
      if (pts.size < 2) pinchD0 = 0;
    };
    el.addEventListener("pointermove", (e) => {
      if (this._suspendedPointers.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD0 > 0 && d > 0) {
          if (Math.abs(d - pinchD0) > 6) pinchMoved = true;
          this.setZoom(Math.max(2, Math.min(19, pinchZ0 + Math.log2(d / pinchD0))), {
            anchor: anchorAt((a.x + b.x) / 2, (a.y + b.y) / 2)
          });
        }
        return;
      }
      panBy(e.clientX - p.px, e.clientY - p.py);
      p.px = e.clientX;
      p.py = e.clientY;
    });
    const endPointer = (e) => {
      if (pinchMoved) this._suppressClickUntil = Date.now() + 400;
      const p = pts.get(e.pointerId);
      const dragged = p ? Math.hypot(e.clientX - p.px, e.clientY - p.py) > 10 : false;
      const now = Date.now();
      const lastTap = this._lastTap || {};
      const dxT = e.clientX - (lastTap.x || 0);
      const dyT = e.clientY - (lastTap.y || 0);
      if (!pinchMoved && !dragged && now - (lastTap.t || 0) < 300 && Math.hypot(dxT, dyT) < 30) {
        this.setZoom(this.zoom + 1, { anchor: anchorAt(e.clientX, e.clientY) });
        this._suppressClickUntil = now + 400;
        this._lastTap = {};
      } else if (!dragged) {
        this._lastTap = { t: now, x: e.clientX, y: e.clientY };
      } else {
        this._lastTap = {};
      }
      pts.delete(e.pointerId);
      this._suspendedPointers.delete(e.pointerId);
      if (pts.size < 2) pinchD0 = 0;
      if (pts.size === 1) {
        const q = [...pts.values()][0];
        q.px = q.x;
        q.py = q.y;
      }
    };
    el.addEventListener("pointerup", endPointer);
    el.addEventListener("pointercancel", endPointer);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1), { anchor: anchorAt(e.clientX, e.clientY) });
    }, { passive: false });
    el.addEventListener("dblclick", (e) => this.setZoom(this.zoom + 1, { anchor: anchorAt(e.clientX, e.clientY) }));
    el.tabIndex = 0;
    el.style.outline = "none";
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 4;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = step;
      else if (e.key === "ArrowRight") dx = -step;
      else if (e.key === "ArrowUp") dy = step;
      else if (e.key === "ArrowDown") dy = -step;
      else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        this.setZoom(this.zoom + 1);
        return;
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        this.setZoom(this.zoom - 1);
        return;
      } else if (e.key === "Escape") {
        if (this._selectedEntity) {
          this.setSelected(null);
          this.dispatchEvent(new CustomEvent("selection-cleared"));
          e.preventDefault();
        }
        return;
      } else return;
      e.preventDefault();
      panBy(dx, dy);
    });
  }
  setZoom(z, opts) {
    this._userMoved = true;
    const next = Math.max(3, Math.min(18, z));
    const anchor = opts?.anchor;
    if (anchor) {
      const w = this.container.clientWidth || 400;
      const h = this.container.clientHeight || 300;
      const c = _CnTileEngine.project(this.center.lat, this.center.lng);
      const w0 = 2 ** this.zoom * 256;
      const w1 = 2 ** next * 256;
      const ax = anchor.x - w / 2;
      const ay = anchor.y - h / 2;
      const wx = c.x + ax / w0;
      const wy = c.y + ay / w0;
      const ncx = wx - ax / w1;
      const ncy = wy - ay / w1;
      this.zoom = next;
      this.center = {
        lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * ncy))) * 180 / Math.PI,
        lng: ncx * 360 - 180
      };
      this.render();
      return;
    }
    this.zoom = next;
    this.render();
  }
  fitBounds(points, padding = 40) {
    if (!points.length) return;
    const pad = typeof padding === "object" ? padding : { top: padding, right: padding, bottom: padding, left: padding };
    const base = {
      top: pad.top ?? 40,
      right: pad.right ?? 40,
      bottom: pad.bottom ?? 40,
      left: pad.left ?? 40
    };
    if (points.length === 1) {
      this.setView(points[0].lat, points[0].lng, 14);
      return;
    }
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    points.forEach((p) => {
      const t = _CnTileEngine.project(p.lat, p.lng);
      minX = Math.min(minX, t.x);
      maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y);
      maxY = Math.max(maxY, t.y);
    });
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    let best = 3;
    for (let z = 18; z >= 3; z--) {
      const n2 = 2 ** z;
      if ((maxX - minX) * n2 * 256 < w - base.left - base.right && (maxY - minY) * n2 * 256 < h - base.top - base.bottom) {
        best = z;
        break;
      }
    }
    const fitCap = Math.max(3, Math.min(16, Math.round(w / 140) + 11));
    best = Math.min(best, fitCap);
    const n = 2 ** best;
    const usedW = w - base.left - base.right;
    const usedH = h - base.top - base.bottom;
    const cxWorld = (minX + maxX) / 2 + (base.right - base.left) / 2 / n / 256;
    const cyWorld = (minY + maxY) / 2 + (base.bottom - base.top) / 2 / n / 256;
    void usedW;
    void usedH;
    this.setView(latFromY(cyWorld), lngFromX(cxWorld), best);
    function latFromY(y) {
      return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
    }
    function lngFromX(x) {
      return x * 360 - 180;
    }
  }
};

// src/card.js
var HaCnMapCard = class _HaCnMapCard extends HTMLElement {
  static getStubConfig() {
    return { show_all: true };
  }
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._preview = false;
    this._trackPoints = {};
    this._trackUnsub = null;
    this._trackSig = "";
    this._hiddenIds = null;
    this._registryTried = false;
    this._focusOnMarkerClick = true;
    this._bleedUser = void 0;
    this._isBleed = false;
    this.addEventListener("keydown", this._onKeyBleed = (e) => {
      if (e.key === "Escape" && this.classList.contains("cmc-bleed")) {
        this._bleedUser = false;
        this._applyBleed(false);
      }
    });
  }
  /* hui-card 在 panel 视图里会直接给卡片元素赋 layout="panel"（官方卡片同样读这个属性） */
  get layout() {
    return this._hLayout;
  }
  set layout(v) {
    const old = this._hLayout;
    this._hLayout = v;
    if (old !== v && this._config && this.isConnected) {
      Promise.resolve().then(() => this._syncLayout());
    }
  }
  get isPanel() {
    return this._hLayout === "panel";
  }
  // hui-card 还会顺手写 element.isPanel；只读会抛错（它有 try/catch，抛了就把卡片换成错误卡），给个空 setter
  set isPanel(_v) {
  }
  /* 官方卡片 API：preview=true 表示这张卡正被渲染在卡片选择器/编辑器里。
     预览态不该真的去订阅历史轨迹（那是一次 WebSocket 请求），也不该铺满全屏 */
  get preview() {
    return this._preview;
  }
  set preview(v) {
    const on = !!v;
    if (on === this._preview) return;
    this._preview = on;
    if (on && this._engine) {
      if (this._trackUnsub) {
        this._trackUnsub();
        this._trackUnsub = null;
      }
      this._trackSig = "";
      this._trackPoints = {};
    }
  }
  /* 官方 hui-map-card 的字段名与我们的内部字段对齐（2026.11 MapCardConfig）。
     同名概念优先用户写的内部字段；只做单向别名，不改写用户原始 YAML。 */
  _applyAliases(raw) {
    const c = { ...raw };
    if (c.auto_fit !== void 0 && c.fit_entities === void 0) {
      c.fit_entities = c.auto_fit !== "zones" && c.auto_fit !== false;
      if (c.fit_zones === void 0) c.fit_zones = c.auto_fit === "zones" || c.auto_fit === "all";
    }
    if (c.cluster !== void 0 && c.show_cluster === void 0) c.show_cluster = !!c.cluster;
    if (c.scale_ruler !== void 0 && c.show_scale === void 0) c.show_scale = !!c.scale_ruler;
    const ms = typeof c.map_style === "string" ? c.map_style.trim().toLowerCase() : "";
    if (ms) {
      if (c.theme_mode === void 0 && (ms === "auto" || ms === "light" || ms === "dark")) c.theme_mode = ms;
      if (c.basemap === void 0) {
        if (ms === "satellite") c.basemap = "amap-satellite";
        else if (ms === "streets" || ms === "auto" || ms === "light" || ms === "dark") c.basemap = "amap";
      }
    }
    if (c.dark_mode !== void 0 && c.theme_mode === void 0) c.theme_mode = c.dark_mode ? "dark" : "light";
    return c;
  }
  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("ha-cn-map-card: 配置无效");
    this._rawConfig = config;
    this._config = {
      basemap: "amap",
      // amap | amap-satellite | tianditu | tianditu-satellite | osm
      tianditu_key: "",
      default_zoom: 12,
      hours_to_show: 0,
      // >0 时绘制轨迹线
      track_width: 3,
      track_opacity: 0.85,
      show_traffic: false,
      // 高德实时路况叠加
      show_all: true,
      // 全部可定位实体（对齐官方地图卡：默认全显示）
      show_zones: true,
      // 默认显示区域（家）
      hidden_entities: [],
      // 设置里逐个取消勾选的实体（永远不上图）
      home_lat: void 0,
      // 家的坐标/半径覆盖（留空则用 zone.home 自身属性）
      home_lng: void 0,
      home_radius: void 0,
      home_address: "",
      show_zone_radius: true,
      // zone 半径圈（官方把半径当 zone 的核心属性）
      dedupe_trackers: true,
      // person 已覆盖的 device_tracker 不再单独画点
      respect_hidden: true,
      // 实体注册表里被用户隐藏（hidden_by）的实体不再上地图
      fit_zones: false,
      // 自动适配视野时把区域半径圈也算进去
      show_labels: true,
      label_mode: "name",
      // name | state | attribute | none（可在 entities 里逐实体覆盖）
      show_status: true,
      // 标记下方状态行（在家 / 离线 / 速度 / 电量 / 相对时间）
      show_accuracy: true,
      // GPS 精度圈（gps_accuracy，对齐官方）
      show_cluster: true,
      // 标记聚合
      fit_entities: true,
      height: 360,
      aspect_ratio: "",
      // 如 "16:9"，填了就忽略 height（官方 aspect_ratio 语义）
      entities: [],
      conditions: [],
      // 条件显示：每条都满足才渲染，否则整卡隐藏（官方条件卡片语义）
      geo_location_sources: [],
      title: "",
      theme_mode: "auto",
      // auto（跟随 HA 主题）| light | dark
      show_scale: true,
      // 比例尺（官方字段 scale_ruler，显式 false 才关）
      ...this._applyAliases(config)
    };
    this._lsKey = storageKey(config);
    if (config.persist !== false) this._applyRuntime(loadRuntime(this._lsKey));
    if (BASEMAPS[this._config.basemap]?.requireKey && !this._config.tianditu_key) {
      console.warn("[ha-cn-map-card] 天地图需要 tianditu_key，已回退到高德");
      this._config.basemap = "amap";
    }
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    const dark = this._resolveDark();
    if (dark !== this._dark) {
      this._dark = dark;
      this.shadowRoot?.querySelector(".cmc-card")?.classList.toggle("is-dark", dark);
    }
    if (this._engine) this._update();
    this._ensureEntityRegistry();
  }
  /* 拉一次实体注册表，缓存 hidden_by 非空的实体集合。
     只在 show_all / geo_location_sources 自动收集时生效；
     用户显式写进 entities: 的实体永远照画——点名了就不替他做决定。
     HA 2023.4+ 才有 hidden_by；拿不到（权限/版本）就置空集合并永不重试 */
  _ensureEntityRegistry() {
    if (this._registryTried || this._preview) return;
    const conn = this._hass?.connection;
    if (!conn?.sendMessagePromise) return;
    this._registryTried = true;
    Promise.resolve().then(() => conn.sendMessagePromise({ type: "config/entity_registry/list" })).then((entries) => {
      this._hiddenIds = new Set(
        (entries || []).filter((e) => e?.hidden_by).map((e) => e.entity_id)
      );
      if (this._hiddenIds.size && this._config?.respect_hidden !== false && this._engine) this._update();
    }).catch(() => {
      this._hiddenIds = /* @__PURE__ */ new Set();
    });
  }
  /* 解析 "16:9" / "4/3" / "21x9" 这类宽高比；非法值返回 null */
  _parseAspect(v) {
    if (!v || typeof v !== "string") return null;
    const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const w = Number(m[1]), h = Number(m[2]);
    return w > 0 && h > 0 ? { w, h } : null;
  }
  /* 宽高比：卡片按比例撑高，全屏态忽略（铺满是第一优先级） */
  _applyAspect() {
    const card = this.shadowRoot?.querySelector(".cmc-card");
    if (!card || typeof this.style === "undefined") return;
    const r = this._isFull ? null : this._parseAspect(this._config?.aspect_ratio);
    card.classList.toggle("is-aspect", !!r);
    card.style.aspectRatio = r ? `${r.w} / ${r.h}` : "";
    this.style.height = this._isFull ? "100%" : r ? "auto" : this._config?.height ? `${this._config.height}px` : "";
  }
  /* 暗色判定：显式 theme_mode 优先，auto 跟随 HA 主题，再兜底系统偏好 */
  _resolveDark() {
    const mode = this._config?.theme_mode || "auto";
    if (mode === "dark") return true;
    if (mode === "light") return false;
    const t = this._hass?.themes?.darkMode;
    if (typeof t === "boolean") return t;
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  }
  /* 把 localStorage 里的运行时设置合并进当前配置（YAML 里的显式值仍可通过 persist:false 关闭） */
  _applyRuntime(opts) {
    if (!opts || typeof opts !== "object") return;
    const cfg = { ...this._config };
    RUNTIME_KEYS.forEach((k) => {
      if (opts[k] !== void 0) cfg[k] = opts[k];
    });
    for (const k of ["home_lat", "home_lng", "home_radius"]) {
      const v = cfg[k];
      if (v !== void 0 && v !== null && v !== "" && !Number.isFinite(Number(v))) delete cfg[k];
    }
    this._config = cfg;
  }
  /* 把当前配置里"运行时可变"的键落盘，下次刷新/切视图仍生效 */
  _saveRuntime() {
    if (this._rawConfig?.persist === false) return;
    const out = {};
    RUNTIME_KEYS.forEach((k) => {
      if (this._config[k] !== void 0 && this._config[k] !== "") out[k] = this._config[k];
    });
    saveRuntime(this._lsKey || storageKey(this._rawConfig), out);
  }
  /* 解析布局：官方 panel 视图 / sections 紧凑 / 自定义全屏 */
  _resolveLayout() {
    const cfg = this._config;
    if (this._hass?.editMode) return LAYOUT.COMPACT;
    if (cfg.layout === "compact" || cfg.fullscreen === false) return LAYOUT.COMPACT;
    if (cfg.fullscreen === true || cfg.layout === "full" || cfg.layout === "panel" || cfg.fill === true) return LAYOUT.FULL;
    if (this.layout === "panel" || this.isPanel === true) return LAYOUT.FULL;
    return this._autoLayout();
  }
  /* 祖先遍历：必须穿透 shadow root，否则 panel 视图里 parentElement 直接是 null
     （卡片挂在 hui-card 的 light DOM 里，再往上是 hui-panel-view 的 shadowRoot） */
  _ancestors(max = 10) {
    const out = [];
    let cur = this;
    let el = cur.parentElement;
    for (let i = 0; i < max && el; i++) {
      out.push(el);
      const root = el.getRootNode?.();
      if (root && root.host) {
        cur = root.host;
        el = cur.parentElement;
        out.push(cur);
      } else {
        el = el.parentElement;
      }
    }
    return out;
  }
  /* 自动判定：往上看几层，找真正给我分配高度的那个祖先。
     HA 的嵌套关系不固定（panel 视图 shadowRoot > hui-card > 卡片；
     sections 视图 hui-grid-section shadowRoot > grid > 格子 > hui-card > 卡片），所以逐层试。 */
  _autoLayout() {
    if (typeof window === "undefined" || !this.isConnected) return LAYOUT.COMPACT;
    const viewH = window.innerHeight || document.documentElement.clientHeight || 800;
    const selfH = this.getBoundingClientRect().height;
    for (const el of this._ancestors(10)) {
      const tag = el.localName || "";
      const r = el.getBoundingClientRect();
      if (/^(hui-grid-section|hui-sections-view)$/.test(tag)) return LAYOUT.COMPACT;
      if (/^(hui-panel-view|hui-masonry-view|hui-grid-view)$/.test(tag)) {
        return r.height > viewH * 0.7 ? LAYOUT.FULL : LAYOUT.COMPACT;
      }
      if (r.height > viewH * 0.8 && r.height > selfH * 1.5) return LAYOUT.FULL;
    }
    return LAYOUT.COMPACT;
  }
  /* ---- 真·全屏（bleed）----
     为什么需要它：sections 视图的格子高度是 JS 定死的 410px 左右，panel 视图里
     hui-card 也可能不给卡片高度——这两种情况 height:100% 都不可能铺满。
     所以只要"该全屏但实际没占满"，就把宿主改成 position:fixed 直接跳出容器。 */
  _parentTooSmall() {
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    const p = this.parentElement;
    if (!p) return true;
    const r = p.getBoundingClientRect();
    return r.height < vh * 0.85;
  }
  _wantBleed() {
    if (this._bleedUser === true) return true;
    if (this._layout !== LAYOUT.FULL) return false;
    if (this._bleedUser === false) return false;
    if (this._config?.fill === true) return true;
    return this._parentTooSmall();
  }
  _applyBleed(on, initial) {
    const has = this.classList.contains("cmc-bleed");
    if (on && !has) {
      this.style.height = "";
      this.classList.add("cmc-bleed");
    } else if (!on && has) {
      this.classList.remove("cmc-bleed");
      this.style.height = this._layout === LAYOUT.FULL ? "100%" : this._config?.height ? `${this._config.height}px` : "";
    }
    const btn = this.shadowRoot?.querySelector("[data-fs]");
    if (btn) {
      const icon = on ? ICONS.fullscreenExit : ICONS.fullscreen;
      btn.querySelector("path")?.setAttribute("d", icon);
      btn.setAttribute("aria-label", on ? "退出全屏" : "全屏");
      btn.setAttribute("title", on ? "退出全屏" : "全屏");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (!initial) {
      this._isBleed = on;
      requestAnimationFrame(() => this._engine?.render());
    }
    this._isBleed = on;
  }
  /* 外部尺寸变化后自愈：该全屏却没铺满就自动升级成 fixed */
  _syncBleed() {
    if (this._layout !== LAYOUT.FULL) return;
    if (this._bleedUser !== void 0) return;
    const want = this._wantBleed();
    if (want !== this.classList.contains("cmc-bleed")) this._applyBleed(want);
  }
  _toggleBleed() {
    const on = !this.classList.contains("cmc-bleed");
    this._bleedUser = on;
    this._applyBleed(on);
  }
  /* 重置焦点：跳回 home 区域中心 + default_zoom，并暂停自动适配，避免下一帧又被 fit 走 */
  _resetFocus() {
    const home = this._hass?.states?.["zone.home"];
    const cfg = this._config || {};
    let lat = cfg.home_lat;
    let lng = cfg.home_lng;
    if (lat == null || lat === "" || lng == null || lng === "") {
      lat = home?.attributes?.latitude;
      lng = home?.attributes?.longitude;
    }
    if (lat == null || lng == null) {
      lat = cfg.center?.latitude;
      lng = cfg.center?.longitude;
    }
    if (lat == null || lng == null) return;
    if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
    this._didFit = true;
    this._engine._userMoved = false;
    this._engine.flyTo(lat, lng, Number(cfg.default_zoom) || 12);
  }
  _render() {
    const prevView = this._engine ? {
      c: { ...this._engine.center },
      z: this._engine.zoom,
      moved: this._engine._userMoved,
      sel: this._engine._selectedEntity || null
      // 重建后要恢复选中光环，否则详情页"选中却无光环"
    } : null;
    const cfg = this._config;
    const base = BASEMAPS[cfg.basemap] || BASEMAPS.amap;
    const layout = this._layout = this._resolveLayout();
    const isFull = layout === LAYOUT.FULL;
    const zoomSide = "right";
    const fill = cfg.fill === true;
    const ar = this._parseAspect(cfg.aspect_ratio);
    const h = isFull ? "100%" : ar ? "auto" : cfg.height ? `${cfg.height}px` : "";
    if (typeof this.style !== "undefined") this.style.height = h || "";
    this._isFull = isFull;
    this._zoomSide = zoomSide;
    const titleHtml = cfg.title ? `<div class="cmc-title">${escapeHtml(cfg.title)}</div>` : "";
    const overlayOpen = this._panelOpen === true;
    const phone = this._isPhone();
    this._phone = phone;
    let sheetOk;
    try {
      sheetOk = phone && !!window.customElements.get("ha-snap-bottom-sheet");
    } catch {
      sheetOk = false;
    }
    this._sheetOk = sheetOk;
    if (phone && !sheetOk && !this._sheetWait) {
      this._sheetWait = true;
      try {
        window.customElements.whenDefined("ha-snap-bottom-sheet").then(() => {
          this._sheetWait = false;
          if (this.isConnected && this._isPhone()) {
            this._render();
            this._update();
          }
        }).catch(() => {
          this._sheetWait = false;
        });
      } catch {
        this._sheetWait = false;
      }
    }
    let rtl;
    try {
      rtl = getComputedStyle(this).direction === "rtl";
    } catch {
      rtl = false;
    }
    this._rtl = rtl;
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block;
          position:relative;
          height:${h};
          min-height:${isFull ? "0" : cfg.height ? "0" : "300px"};
          ${isFull || fill ? "min-height:0;" : ""}
          --cmc-radius: var(--ha-card-border-radius, 12px);
          --cmc-surface: var(--card-background-color, #fff);
          --cmc-text: var(--primary-text-color, #111);
          --cmc-sub: var(--secondary-text-color, #666);
          --cmc-divider: var(--divider-color, rgba(128,128,128,.22));
          --cmc-fill: var(--ha-color-fill-neutral-quiet-resting, rgba(128,128,128,.12));
          --cmc-shadow: var(--ha-box-shadow-m, 0 2px 8px rgba(0,0,0,.22));
        }
        /* ---- 真·全屏：脱离文档流铺满视口 ----
           sections 视图的 grid 格子是固定高度，panel 视图也可能不给卡片高度，
           靠 height:100% 永远突破不了。此处 position:fixed 直接跳出容器。 */
        :host(.cmc-bleed) {
          position:fixed !important;
          top:var(--header-height, 0px) !important;
          left:0 !important; right:0 !important; bottom:0 !important;
          width:auto !important; height:auto !important;
          min-height:0 !important; max-height:none !important;
          margin:0 !important; padding:0 !important;
          border-radius:0 !important;
          /* 必须高于 HA 侧栏（展开态会盖住面板）；同时保持低于全局弹层层级 */
          z-index:1200;
          background:var(--map-background-color, #121212);
        }
        :host(.cmc-bleed) .cmc-card {
          border-radius:0; border:none;
          height:100%; width:100%;
          background:var(--map-background-color, #121212);
        }
        /* 轨迹点悬停提示（v1.0.8）：跟随鼠标的极小浮层 */
        .cmc-tip {
          position:absolute; z-index:30; pointer-events:none; white-space:nowrap;
          padding:3px 7px; border-radius:6px; font-size:11.5px; line-height:1.3;
          font-variant-numeric:tabular-nums;
          background:var(--card-background-color, #fff); color:var(--primary-text-color, #212121);
          box-shadow:0 2px 8px rgba(0,0,0,.28);
          transform:translate(-50%, -100%); transition:opacity .1s;
        }
        .cmc-tip[hidden] { display:none; }
        .cmc-card.is-aspect { height:auto; position:relative; }
        .cmc-card {
          position:absolute; inset:0; overflow:hidden;
          border-radius:var(--cmc-radius);
          background:${isFull ? "var(--map-background-color, #121212)" : "var(--cmc-surface)"};
          ${isFull ? "border:none;" : "border:1px solid var(--ha-card-border-color, rgba(0,0,0,.12));"}
          box-sizing:border-box;
        }
        .cmc-map { position:absolute; inset:0; overflow:hidden; cursor:grab; }
        /* ---- 暗色底图：高德/天地图没有暗色瓦片，用 CSS filter 近似（官方矢量图是双配色，
           栅格图只能这么来）。卫星影像与路况叠加带 .cmc-nofilter，不参与反色 ---- */
        .cmc-card.is-dark .cmc-layer:not(.cmc-nofilter) {
          filter: invert(1) hue-rotate(180deg) brightness(.88) contrast(.92) saturate(.75);
        }
        .cmc-map:active { cursor:grabbing; }
        .cmc-title {
          position:absolute; top:0; left:0; right:0; height:44px; z-index:12;
          display:flex; align-items:center; padding:0 16px; font-weight:500;
          font-size:18px; background:var(--cmc-surface); color:var(--cmc-text);
          box-shadow:var(--cmc-shadow);
        }
        /* ---- 控件：半透明黑底 + 白描边，深色地图上也清晰 ---- */
        .cmc-ctrl {
          position:absolute; z-index:14; display:flex; flex-direction:column; gap:6px;
          top:${cfg.title ? 56 : 8}px;
          ${zoomSide}:8px;
        }
        /* 官方：缩放组在最上，其余图标依次向下 */
        .cmc-ctrl > .cmc-ctrl-group + button { margin-top:2px; }
        .cmc-ctrl-group {
          display:flex; flex-direction:column;
          background:rgba(0,0,0,.55); border-radius:24px;
          box-shadow:0 1px 4px rgba(0,0,0,.4), inset 0 0 0 1px rgba(255,255,255,.12); overflow:hidden;
        }
        .cmc-ctrl-group > button + button { border-top:1px solid rgba(255,255,255,.15); border-radius:0; }
        .cmc-ctrl button {
          width:40px; height:40px; border:none; background:rgba(0,0,0,.55);
          color:#fff; cursor:pointer; display:flex; align-items:center;
          justify-content:center; padding:0; border-radius:20px;
          box-shadow:0 1px 4px rgba(0,0,0,.4), inset 0 0 0 1px rgba(255,255,255,.12);
          transition:background .15s;
          -webkit-tap-highlight-color:transparent;
        }
        .cmc-ctrl-group button { box-shadow:none; border-radius:0; background:transparent; }
        .cmc-ctrl button:hover { background:rgba(0,0,0,.75); }
        .cmc-ctrl button[aria-pressed="true"] { color:var(--primary-color, #03a9f4); }
        .cmc-ctrl svg { width:22px; height:22px; fill:currentColor; pointer-events:none; }
        /* ---- 比例尺：官方左下角白底小块 ---- */
        .cmc-scale {
          position:absolute; left:8px; bottom:8px; z-index:9;
          font-size:11px; color:#111; line-height:1;
          background:rgba(255,255,255,.9); padding:4px 6px; border-radius:3px;
          pointer-events:none; font-variant-numeric:tabular-nums;
          box-shadow:0 0 0 1px rgba(0,0,0,.12);
        }
        .cmc-scale .bar { height:5px; margin-top:3px; border:1px solid #111; border-top:none; }
        /* 桌面左侧面板展开时把比例尺顶上去，别被压住；手机端见顶部居中规则，不受此影响 */
        .cmc-card:has(.cmc-panel.open.dock-bottom) .cmc-scale { bottom:45%; transition:bottom .28s ease; }
        /* ---- 标记：官方 48px 圆角方块 + 白边 ---- */
        .cmc-marker img { width:44px; height:44px; border-radius:50%; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.4); object-fit:cover; display:block; }
        .cmc-marker.is-offline img,
        .cmc-marker.is-offline .cmc-fallback { filter:grayscale(1); opacity:.6; }
        /* 选中高亮：官方聚焦实体时标记带主题色光环 */
        .cmc-marker.is-selected img,
        .cmc-marker.is-selected .cmc-fallback {
          border-color:var(--primary-color, #03a9f4);
          box-shadow:0 0 0 5px color-mix(in srgb, var(--primary-color, #03a9f4) 30%, transparent), 0 1px 4px rgba(0,0,0,.4);
        }
        /* 长按进入可拖状态（防误触）：给 home 标记一个明确的高亮反馈 */
        .cmc-marker.cmc-armed img,
        .cmc-marker.cmc-armed .cmc-fallback {
          border-color:var(--accent-color, #ffb300);
          box-shadow:0 0 0 6px color-mix(in srgb, var(--accent-color, #ffb300) 35%, transparent), 0 1px 6px rgba(0,0,0,.5);
        }
        /* 半径手柄被长按 arm 时同步高亮（SVG 圆） */
        svg .cmc-radius-handle.cmc-armed,
        .cmc-radius-handle.cmc-armed { filter:drop-shadow(0 0 4px var(--accent-color, #ffb300)); }
        /* 图标内部禁止 flex 拉伸：ha-icon / img 都会被父级叠加居中，压到文字行上 */
        .cmc-marker > *:first-child { flex:0 0 auto; }
        .cmc-marker .cmc-fallback {
          width:44px; height:44px; margin:0 auto; border-radius:50%; border:3px solid #fff;
          --mdc-icon-size:22px; box-sizing:border-box;
          box-shadow:0 1px 4px rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center;
          font-size:18px; background:#58a6f0; color:#fff;
        }
        .cmc-marker .cmc-label {
          margin-top:3px; font-size:11px; color:#fff; display:inline-block;
          background:rgba(0,0,0,.55); padding:1px 6px; border-radius:8px;
          white-space:nowrap; max-width:120px; overflow:hidden; text-overflow:ellipsis;
        }
        /* 名称与状态各自成行：inline-block 会让两段文字并排，垂直居中的 padding 叠加后
           下层被地图瓦片盖住（父级只有 44px 图标的视觉空间，靠容器自动高度撑开） */
        .cmc-marker .cmc-label-sub {
          display:block; width:fit-content; max-width:120px; margin:1px auto 0;
          font-size:10px; line-height:1.35; padding:0 5px; border-radius:7px;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          background:rgba(0,0,0,.42); opacity:.9;
        }
        .cmc-marker .cmc-label-sub:empty { display:none; }
        .cmc-home { font-size:30px; --mdc-icon-size:30px; color:#ff9800; filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); }
        .cmc-cluster-avatar {
          width:34px; height:34px; border-radius:50%; border:3px solid #58a6f0;
          box-sizing:border-box; background:var(--cmc-surface);
          display:flex; align-items:center; justify-content:center;
          font-size:13px; font-weight:600; color:var(--cmc-text);
          box-shadow:0 1px 4px rgba(0,0,0,.4); overflow:hidden;
        }
        .cmc-cluster-count {
          min-width:34px; height:34px; padding:0 7px; box-sizing:border-box; border-radius:17px;
          background:var(--cmc-surface); color:var(--cmc-text); font-size:13px; font-weight:600;
          display:flex; align-items:center; justify-content:center;
          box-shadow:0 1px 4px rgba(0,0,0,.4); border:2px solid var(--cmc-surface);
        }
        .cmc-panel-btn {
          position:absolute; z-index:19; top:12px; left:12px;
          width:44px; height:44px; border-radius:22px; border:none;
          background:rgba(0,0,0,.55); color:#fff;
          box-shadow:0 1px 4px rgba(0,0,0,.4), inset 0 0 0 1px rgba(255,255,255,.12); cursor:pointer;
          display:flex; align-items:center; justify-content:center;
          padding:0; transition:opacity .2s ease, transform .28s ease;
        }
        .cmc-panel-btn svg { width:22px; height:22px; fill:currentColor; }
        .cmc-panel-btn.hide { opacity:0; pointer-events:none; transform:scale(.6); }
        .cmc-panel-btn:hover { filter:brightness(1.08); }
        /* 手机：抽屉完全隐藏，只留左下角圆形按钮（对齐官方）；
           比例尺固定顶部居中（顶部标题栏不占位置，左右缩放控件不冲突） */
        @media (max-width: 600px) {
          .cmc-panel-btn { top:auto; bottom:16px; left:10px; }
          .cmc-scale { left:50%; transform:translateX(-50%); top:10px; bottom:auto; }
        }

        .cmc-attribution { color:var(--cmc-sub); }

        /* ================= 概览面板（对齐官方 底部抽屉 / 左侧浮层） ================= */
        .cmc-panel {
          position:absolute; z-index:20; box-sizing:border-box;
          background:var(--cmc-surface); color:var(--cmc-text);
          box-shadow:var(--cmc-shadow);
          display:flex; flex-direction:column;
          transition:transform .28s ease, max-height .28s ease;
        }
        /* 桌面/面板视图：左侧浮层卡片 */
        .cmc-panel.dock-auto {
          top:12px; left:12px; width:min(340px, calc(100% - 24px));
          max-height:calc(100% - 24px); border-radius:16px; overflow:hidden;
          transform:translateX(calc(-100% - 16px));
        }
        .cmc-panel.dock-auto.open { transform:none; }
        /* 官方：窄屏（手机）改成底部抽屉 */
        @media (max-width: 600px) {
          .cmc-panel.dock-auto {
            top:auto; left:0; right:0; bottom:0; width:auto;
            border-radius:16px 16px 0 0;
            height:max(120px, min(280px, 62%));
            transform:translateY(100%);
          }
          .cmc-panel.dock-auto.open { transform:none; top:45%; height:auto; }
        }
        /* 底部抽屉（紧凑卡片 / 手机全屏共用）：高度不超过卡片 70% */
        .cmc-panel.dock-bottom {
          left:0; right:0; bottom:0; top:auto; border-radius:16px 16px 0 0;
          height:max(120px, min(280px, 62%));
        }
        .cmc-panel.dock-bottom.open { top:45%; height:auto; }
        /* 详情页（最近活动）内容更高：紧凑卡片里也把抽屉抬高一点，别只剩两行 */
        .cmc-panel.dock-bottom.open.is-detail { top:18%; }
        .cmc-panel.dock-bottom:not(.open) { transform:translateY(100%); }
        /* 手机：内容交给官方 ha-snap-bottom-sheet 定位/拖拽，容器只负责排版 */
        .cmc-panel.in-sheet {
          position:static; width:auto; max-height:none; height:auto;
          border-radius:0; box-shadow:none; background:var(--cmc-surface);
          transform:none; transition:none;
        }
        .cmc-panel.in-sheet .cmc-panel-handle { display:none; }
        /* 桌面非抽屉模式：不需要拖拽把手 */
        .cmc-panel:not(.in-sheet) .cmc-panel-handle { display:none; }
        /* RTL：左侧浮层镜像到右侧（官方面板同样按 dir 镜像） */
        .cmc-card.is-rtl .cmc-panel.dock-auto {
          left:auto; right:12px; transform:translateX(calc(100% + 16px));
        }
        .cmc-card.is-rtl .cmc-panel.dock-auto.open { transform:none; }
        .cmc-card.is-rtl .cmc-panel-btn { left:auto; right:12px; }
        .cmc-card.is-rtl .cmc-item, .cmc-card.is-rtl .cmc-det-name,
        .cmc-card.is-rtl .cmc-det-sub, .cmc-card.is-rtl .cmc-act-hl { text-align:right; }
        .cmc-panel-handle {
          flex:none; height:20px; display:flex; align-items:center; justify-content:center;
          cursor:pointer; touch-action:none;
        }
        .cmc-panel-handle::before {
          content:""; width:32px; height:4px; border-radius:2px; background:var(--cmc-divider);
        }
        .cmc-panel-h {
          flex:none; display:flex; align-items:center; gap:8px;
          padding:0 12px 8px;
        }
        /* 面板内的每个子视图自己撑满并滚动（列表 / 详情 / 设置） */
        .cmc-panel > [data-view]:not([hidden]) {
          display:flex; flex-direction:column; flex:1; min-height:0;
        }
        .cmc-tabs {
          position:relative; flex:1; display:flex; gap:4px; padding:4px;
          border-radius:12px; background:var(--cmc-fill);
        }
        .cmc-tabs .pill {
          position:absolute; top:4px; bottom:4px; border-radius:9px;
          background:var(--cmc-surface); box-shadow:0 1px 3px rgba(0,0,0,.18);
          transition:left .2s ease, width .2s ease;
        }
        .cmc-tabs button {
          position:relative; flex:1; min-width:0; border:none; margin:0; padding:8px 6px;
          border-radius:9px; background:none; cursor:pointer; font-family:inherit;
          font-size:14px; font-weight:500; color:var(--cmc-sub);
          transition:color .18s; -webkit-tap-highlight-color:transparent;
        }
        .cmc-tabs button[aria-selected="true"] { color:var(--cmc-text); }
        .cmc-tabs button:disabled { opacity:.4; cursor:default; }
        .cmc-panel-close {
          flex:none; width:36px; height:36px; border:none; background:none;
          color:var(--cmc-sub); cursor:pointer; border-radius:18px; display:flex;
          align-items:center; justify-content:center;
        }
        .cmc-panel-close:hover { background:var(--cmc-fill); }
        .cmc-panel-close svg { width:20px; height:20px; fill:currentColor; }
        .cmc-list { flex:1; min-height:0; overflow-y:auto; padding:0 8px 12px; -webkit-overflow-scrolling:touch; }
        .cmc-item { color:var(--cmc-text); }
        .cmc-item-av {
          flex:none; width:40px; height:40px; border-radius:50%; overflow:hidden;
          display:flex; align-items:center; justify-content:center;
          background:var(--cmc-fill); color:var(--cmc-sub);
          font-size:16px; font-weight:600;
        }
        .cmc-item-av img { width:100%; height:100%; object-fit:cover; display:block; }
        .cmc-item-av ha-icon { --mdc-icon-size:22px; }
        .cmc-empty {
          padding:28px 12px; text-align:center; font-size:13px; color:var(--cmc-sub);
        }

        /* ================= 实体详情 + 最近活动（对齐官方 hui-map-overview） ================= */
        .cmc-det-hd { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
        .cmc-det-name { font-size:15px; font-weight:600; color:var(--cmc-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cmc-det-sub { font-size:12px; color:var(--cmc-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cmc-act { flex:1; min-height:0; padding:0 14px 12px; overflow-y:auto; -webkit-overflow-scrolling:touch; }
        .cmc-act-h {
          display:flex; align-items:center; gap:8px; padding:10px 0 6px;
          font-size:13px; font-weight:600; color:var(--cmc-sub);
        }
        .cmc-act-h svg { width:16px; height:16px; fill:currentColor; }
        .cmc-act-body { display:flex; flex-direction:column; }
        .cmc-act-empty { font-size:12.5px; color:var(--cmc-sub); padding:4px 0 8px; }
        .cmc-act-row {
          display:flex; align-items:center; gap:10px; padding:8px 0;
        }
        .cmc-act-row + .cmc-act-row { border-top:1px solid var(--cmc-divider); }
        .cmc-act-av {
          flex:none; width:32px; height:32px; border-radius:50%; overflow:hidden;
          display:flex; align-items:center; justify-content:center;
          background:var(--cmc-fill); color:var(--cmc-sub); font-size:13px; font-weight:600;
        }
        .cmc-act-av img { width:100%; height:100%; object-fit:cover; display:block; }
        .cmc-act-tx { min-width:0; display:flex; flex-direction:column; gap:1px; }
        .cmc-act-hl { font-size:13.5px; color:var(--cmc-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cmc-act-when { font-size:11.5px; color:var(--cmc-sub); font-variant-numeric:tabular-nums; }
        .cmc-act-more {
          border:none; background:none; cursor:pointer; font-family:inherit;
          color:var(--primary-color, #03a9f4); font-size:13px; padding:8px 0 4px; text-align:left;
        }

        /* ================= 设置面板（复用同一容器） ================= */
        .cmc-set-b { flex:1; min-height:0; overflow-y:auto; padding:4px 14px 14px; display:flex; flex-direction:column; gap:12px; }
        .cmc-set-b label { display:flex; flex-direction:column; gap:5px; font-size:12px; color:var(--cmc-sub); }
        .cmc-set-b label.chk { flex-direction:row; align-items:center; justify-content:space-between; gap:8px; font-size:14px; color:var(--cmc-text); }
        .cmc-set-b label.chk input { width:18px; height:18px; accent-color:var(--primary-color,#03a9f4); }
        .cmc-set-b select, .cmc-set-b input[type=text] {
          width:100%; box-sizing:border-box; padding:9px 10px; border-radius:10px;
          border:1px solid var(--cmc-divider); font-size:14px; font-family:inherit;
          background:var(--cmc-surface); color:var(--cmc-text);
        }
        .cmc-set-f {
          flex:none; padding:10px 14px; border-top:1px solid var(--cmc-divider);
          display:flex; align-items:center; justify-content:space-between; gap:8px;
          font-size:11px; color:var(--cmc-sub);
        }
        .cmc-set-sec { border:1px solid var(--cmc-divider); border-radius:12px; padding:10px 12px; display:flex; flex-direction:column; gap:10px; }
        .cmc-set-sec-h { font-size:13px; font-weight:600; color:var(--cmc-text); display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .cmc-set-count { font-size:11px; font-weight:400; color:var(--cmc-sub); }
        .cmc-set-row { display:flex; gap:10px; }
        .cmc-set-row label { flex:1; min-width:0; }
        .cmc-set-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .cmc-set-actions button { border:1px solid var(--cmc-divider); background:none; color:var(--cmc-text); border-radius:8px; padding:6px 10px; font-size:12px; font-family:inherit; cursor:pointer; }
        .cmc-set-hint { font-size:11.5px; color:var(--cmc-sub); }
        .cmc-set-b input[type=number] {
          width:100%; box-sizing:border-box; padding:9px 10px; border-radius:10px;
          border:1px solid var(--cmc-divider); font-size:14px; font-family:inherit;
          background:var(--cmc-surface); color:var(--cmc-text);
        }
        .cmc-ent-list { display:flex; flex-direction:column; gap:2px; max-height:260px; overflow-y:auto; }
        .cmc-ent-group { font-size:11px; font-weight:600; color:var(--cmc-sub); padding:8px 0 2px; }
        .cmc-set-b .cmc-ent {
          display:flex; flex-direction:row; align-items:center; gap:8px; padding:6px 0;
          font-size:13px; color:var(--cmc-text); cursor:pointer;
        }
        .cmc-ent input { width:17px; height:17px; flex:none; accent-color:var(--primary-color,#03a9f4); }
        .cmc-ent-n { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cmc-ent-id { flex:none; max-width:46%; font-size:11px; color:var(--cmc-sub); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cmc-set-f button {
          border:1px solid var(--cmc-divider); background:none; cursor:pointer;
          border-radius:8px; padding:5px 10px; font-size:12px; font-family:inherit;
          color:var(--cmc-text);
        }
      </style>
      <div class="cmc-card${rtl ? " is-rtl" : ""}">
        <div class="cmc-tip" hidden></div>
        ${titleHtml}
        <div class="cmc-map"></div>

        <div class="cmc-ctrl">
          <div class="cmc-ctrl-group">
            <button data-z="1" aria-label="放大"><svg viewBox="0 0 24 24"><path d="${ICONS.plus}"/></svg></button>
            <button data-z="-1" aria-label="缩小"><svg viewBox="0 0 24 24"><path d="${ICONS.minus}"/></svg></button>
          </div>
          <button data-fit aria-label="显示全部" title="显示全部"><svg viewBox="0 0 24 24"><path d="${ICONS.focus}"/></svg></button>
          <button data-cluster aria-label="切换分组" title="切换分组" aria-pressed="${cfg.show_cluster !== false}"><svg viewBox="0 0 24 24"><path d="${cfg.show_cluster !== false ? ICONS.cluster : ICONS.clusterOff}"/></svg></button>
          <button data-reset-focus aria-label="重置焦点" title="重置焦点"><svg viewBox="0 0 24 24"><path d="${ICONS.resetFocus}"/></svg></button>
          <button data-gear aria-label="地图设置" title="地图设置"><svg viewBox="0 0 24 24"><path d="${ICONS.cog}"/></svg></button>
          <button data-lock aria-label="解锁家位置" title="解锁家位置" aria-pressed="true"><svg viewBox="0 0 24 24"><path d="${ICONS.lock}"/></svg></button>
          <button data-fs aria-label="全屏" title="全屏" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="${ICONS.fullscreen}"/></svg></button>
        </div>

        <div class="cmc-scale" aria-hidden="true"></div>

        <button class="cmc-panel-btn${overlayOpen ? " hide" : ""}" data-panel-btn aria-label="打开面板" title="打开面板">
          <svg viewBox="0 0 24 24"><path d="${ICONS.people}"/></svg>
        </button>
        ${sheetOk ? `<ha-snap-bottom-sheet data-sheet min-height="56" label="地图概览">` : ""}
        <div class="cmc-panel ${sheetOk ? "in-sheet" : `dock-${isFull ? "auto" : "bottom"}${overlayOpen ? " open" : ""}`}" data-panel>          <div class="cmc-panel-handle" data-handle></div>
          <div data-view="list">
            <div class="cmc-panel-h">
              <div class="cmc-tabs" role="tablist" aria-label="地图概览分组">
                <span class="pill" aria-hidden="true"></span>
                <button type="button" role="tab" id="cmc-tab-people" aria-controls="cmc-tabpanel" aria-selected="true" tabindex="0" data-tab="people">人</button>
                <button type="button" role="tab" id="cmc-tab-devices" aria-controls="cmc-tabpanel" aria-selected="false" tabindex="-1" data-tab="devices">设备</button>
                <button type="button" role="tab" id="cmc-tab-zones" aria-controls="cmc-tabpanel" aria-selected="false" tabindex="-1" data-tab="zones">区域</button>
              </div>
              <button class="cmc-panel-close" data-panel-close aria-label="收起">
                <svg viewBox="0 0 24 24"><path d="${ICONS.minus}"/></svg>
              </button>
            </div>
            <div class="cmc-list" id="cmc-tabpanel" role="tabpanel" aria-labelledby="cmc-tab-people" data-list></div>
          </div>
          <div data-view="detail" hidden>
            <div class="cmc-panel-h">
              <button class="cmc-panel-close" data-detail-back aria-label="返回列表">
                <svg viewBox="0 0 24 24"><path d="${ICONS.chevronLeft}"/></svg>
              </button>
              <span class="cmc-det-hd">
                <span class="cmc-det-name" data-det-name></span>
                <span class="cmc-det-sub" data-det-sub></span>
              </span>
              <button class="cmc-panel-close" data-det-nav aria-label="导航" title="导航" hidden>
                <svg viewBox="0 0 24 24"><path d="${ICONS.nav}"/></svg>
              </button>
              <button class="cmc-panel-close" data-det-set aria-label="实体设置" title="实体设置" hidden>
                <svg viewBox="0 0 24 24"><path d="${ICONS.cog}"/></svg>
              </button>
              <button class="cmc-panel-close" data-det-close aria-label="收起">
                <svg viewBox="0 0 24 24"><path d="${ICONS.minus}"/></svg>
              </button>
            </div>
            <div class="cmc-act">
              <div class="cmc-act-h">
                <svg viewBox="0 0 24 24"><path d="${ICONS.history}"/></svg>
                <span>最近活动</span>
              </div>
              <div class="cmc-act-body" data-activity></div>
            </div>
          </div>
          <div data-view="settings" hidden>
            <div class="cmc-panel-h">
              <span style="flex:1;font-size:16px;font-weight:500">地图设置</span>
              <button class="cmc-panel-close" data-set-close aria-label="返回">
                <svg viewBox="0 0 24 24"><path d="${ICONS.minus}"/></svg>
              </button>
            </div>
            <div class="cmc-set-b">
              <label>底图
                <select data-d="basemap">
                  <option value="amap">高德地图</option>
                  <option value="amap-satellite">高德卫星</option>
                  <option value="tianditu">天地图</option>
                  <option value="tianditu-satellite">天地图卫星</option>
                  <option value="osm">OpenStreetMap</option>
                </select>
              </label>
              <label>主题
                <select data-d="theme_mode">
                  <option value="auto">跟随 Home Assistant</option>
                  <option value="light">始终浅色</option>
                  <option value="dark">始终深色</option>
                </select>
              </label>
              <label data-d-row="tianditu tianditu-satellite">天地图 Key
                <input type="text" data-d="tianditu_key" placeholder="粘贴 tk">
              </label>
              <label class="chk"><span>标记聚合</span><input type="checkbox" data-d="show_cluster"></label>
              <label class="chk"><span>显示名称</span><input type="checkbox" data-d="show_labels"></label>
              <label>标签内容
                <select data-d="label_mode">
                  <option value="name">实体名称</option>
                  <option value="state">状态（在家 / 45 km/h）</option>
                  <option value="none">不显示</option>
                </select>
              </label>
              <label class="chk"><span>标记显示状态</span><input type="checkbox" data-d="show_status"></label>
              <label class="chk"><span>GPS 精度圈</span><input type="checkbox" data-d="show_accuracy"></label>
              <label class="chk"><span>跳过已隐藏实体</span><input type="checkbox" data-d="respect_hidden"></label>
              <label class="chk"><span>实时路况（仅高德）</span><input type="checkbox" data-d="show_traffic"></label>
              <label class="chk"><span>显示比例尺</span><input type="checkbox" data-d="show_scale"></label>
              <label>轨迹时长
                <select data-d="hours_to_show">
                  <option value="0">关闭</option>
                  <option value="1">1 小时</option>
                  <option value="6">6 小时</option>
                  <option value="12">12 小时</option>
                  <option value="24">24 小时</option>
                  <option value="48">48 小时</option>
                  <option value="168">7 天</option>
                </select>
              </label>

              <div class="cmc-set-sec">
                <div class="cmc-set-sec-h">家的区域</div>
                <label class="chk"><span>显示区域（家）</span><input type="checkbox" data-d="show_zones"></label>
                <label class="chk"><span>区域半径圈</span><input type="checkbox" data-d="show_zone_radius"></label>
                <label>家庭地址 <input type="text" data-lazy data-d="home_address" placeholder="填地址后点下方按钮解析（需高德 Key）"></label>
                <div class="cmc-set-row">
                  <label>纬度 <input type="number" step="any" data-d="home_lat" placeholder=""></label>
                  <label>经度 <input type="number" step="any" data-d="home_lng" placeholder=""></label>
                </div>
                <label>半径（米） <input type="number" min="0" step="10" data-d="home_radius" placeholder="留空则用 HA 区域自身半径"></label>
                <div class="cmc-set-actions">
                  <button data-geocode>解析地址并填入坐标</button>
                  <span class="cmc-set-hint" data-geo-hint></span>
                </div>
                <span class="cmc-set-hint">地图上可直接拖家里的图标改位置，拖半径圈右侧白点改半径</span>
                <label>高德 Web 服务 Key <input type="text" data-lazy data-d="amap_key" placeholder="可选，仅用于地址解析"></label>
              </div>

              <div class="cmc-set-sec">
                <div class="cmc-set-sec-h">地图实体 <span class="cmc-set-count" data-ent-count></span></div>
                <label class="chk"><span>全部可定位</span><input type="checkbox" data-d="show_all"></label>
                <div class="cmc-ent-list" data-ent-list></div>
              </div>
            </div>
            <div class="cmc-set-f">
              <span>设置保存在本浏览器</span>
              <button data-reset type="button">恢复默认</button>
            </div>
          </div>
        </div>
        ${sheetOk ? "</ha-snap-bottom-sheet>" : ""}
      </div>
    `;
    this._applyBleed(this._wantBleed(), true);
    const mapEl = this.shadowRoot.querySelector(".cmc-map");
    this._engine = new CnTileEngine(mapEl);
    this._homeLocked = true;
    this._engine._homeLocked = true;
    this._engine.onTrackHover = (info) => this._showTrackTip(info);
    this._engine.removeTileSets();
    base.layers.forEach((l, i) => {
      this._engine.addTileSet({
        url: (x, y, z) => l.template(x, y, z, cfg.tianditu_key),
        maxZoom: base.maxZoom,
        opacity: l.opacity ?? 1,
        zIndex: i + 1,
        nofilter: !!base.noFilter
      });
    });
    this._engine.attribution.textContent = base.attribution;
    this._engine.scaleEl = this.shadowRoot.querySelector(".cmc-scale");
    this._engine.addEventListener("marker-click", (e) => {
      const id = e.detail.entityId;
      const ent = this._hass?.states?.[id];
      if (!ent || !this._hass) return;
      if (this._focusOnMarkerClick) {
        const wasSelected = this._engine._selectedEntity === id;
        if (wasSelected) {
          this._openMoreInfo(id);
        } else {
          this.focusEntity(id);
        }
      } else {
        this._openMoreInfo(id);
      }
    });
    this._engine.addEventListener("marker-drag", (e) => this._onHomeDrag(e.detail));
    this._engine.addEventListener("circle-radius", (e) => this._onHomeRadius(e.detail));
    this._engine.addEventListener("selection-cleared", () => {
      this._writeSelection(null);
      if (this._panelView === "detail") {
        this._setPanelView?.("list");
        this._renderList();
      }
    });
    this.shadowRoot.querySelectorAll("button").forEach((btn) => btn.setAttribute("type", "button"));
    const panel = this.shadowRoot.querySelector("[data-panel]");
    const listView = panel.querySelector('[data-view="list"]');
    const setView = panel.querySelector('[data-view="settings"]');
    const detView = panel.querySelector('[data-view="detail"]');
    this._panelEl = panel;
    this._panelView = this._panelView || "list";
    const showView = (v) => {
      this._panelView = v;
      listView.hidden = v !== "list";
      setView.hidden = v !== "settings";
      detView.hidden = v !== "detail";
      panel.classList.toggle("is-detail", v === "detail");
      if (v === "settings") this._syncDrawer();
    };
    const setOpen = (open) => {
      this._panelOpen = open;
      panel.classList.toggle("open", open);
      this.shadowRoot.querySelector("[data-panel-btn]")?.classList.toggle("hide", open);
      if (open) showView(this._panelView || "list");
      const sheet2 = this.shadowRoot.querySelector("[data-sheet]");
      if (sheet2) {
        try {
          sheet2.snapTo(open ? "half" : "collapsed");
        } catch {
        }
      }
    };
    this._setPanelOpen = setOpen;
    this._setPanelView = showView;
    const sheet = this.shadowRoot.querySelector("[data-sheet]");
    if (sheet) {
      this._sheet = sheet;
      const head = panel.querySelector(".cmc-panel-h");
      const peek = head ? Math.round(head.getBoundingClientRect().height) : 0;
      if (peek > 0) sheet.minHeight = peek + 10;
      sheet.addEventListener("bottom-sheet-resized", (e) => {
        const d = e.detail || {};
        this._sheetH = Math.round(Number(d.height) || 0);
        this._sheetHalf = Math.round(Number(d.halfHeight) || 0);
        this._engine?.render();
        if (this._fitRefitTimer) clearTimeout(this._fitRefitTimer);
        this._fitRefitTimer = setTimeout(() => {
          this._fitRefitTimer = null;
          if (this._engine && !this._engine._userMoved && !this._userSelected) {
            this._didFit = false;
            this._update();
          }
        }, 250);
      });
    } else {
      this._sheet = null;
      this._sheetH = 0;
    }
    setOpen(overlayOpen || this._isFull && this._panelView !== "settings" && this._panelUserClosed !== true);
    panel.querySelectorAll("[data-tab]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this._tab = b.dataset.tab;
        this._renderList();
      });
    });
    panel.querySelector(".cmc-tabs")?.addEventListener("keydown", (e) => {
      const key = e.key;
      const dir = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
      if (!dir && key !== "Home" && key !== "End") return;
      const btns = [...panel.querySelectorAll("[data-tab]")].filter((b) => !b.hidden && !b.disabled);
      if (!btns.length) return;
      const cur = btns.findIndex((b) => b.dataset.tab === this._tab);
      let idx;
      if (key === "Home") idx = 0;
      else if (key === "End") idx = btns.length - 1;
      else {
        const step = this._rtl ? -dir : dir;
        idx = ((cur < 0 ? 0 : cur) + step + btns.length) % btns.length;
      }
      const next = btns[idx];
      e.preventDefault();
      e.stopPropagation();
      this._tab = next.dataset.tab;
      this._renderList();
      next.focus();
    });
    panel.querySelector("[data-handle]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(!this._panelOpen);
      if (!this._panelOpen) this._panelUserClosed = true;
    });
    this.shadowRoot.querySelector("[data-panel-btn]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._panelUserClosed = false;
      setOpen(true);
    });
    panel.querySelector("[data-back]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(false);
      this._panelUserClosed = true;
    });
    panel.querySelector("[data-detail-back]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showView("list");
      this._renderList();
    });
    panel.querySelector("[data-det-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(false);
      this._panelUserClosed = true;
    });
    panel.querySelector("[data-det-nav]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._openDirections();
    });
    panel.querySelector("[data-det-set]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._detailEntity) this._openMoreInfo(this._detailEntity, true);
    });
    panel.querySelector("[data-panel-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(false);
      this._panelUserClosed = true;
    });
    panel.querySelector("[data-set-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      showView("list");
      this._renderList();
    });
    this.shadowRoot.querySelector("[data-gear]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._isFull && this._panelOpen && this._panelView === "settings") {
        showView("list");
        this._renderList();
      } else {
        showView("settings");
        setOpen(true);
      }
    });
    panel.querySelector("[data-geocode]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._geocodeHome();
    });
    panel.querySelector("[data-ent-list]")?.addEventListener("change", (e) => {
      const id = e.target?.dataset?.ent;
      if (id) this._toggleEntity(id, !!e.target.checked);
    });
    panel.querySelectorAll("[data-d]").forEach((el) => {
      const evt = el.type === "checkbox" || el.tagName === "SELECT" || el.dataset.lazy !== void 0 ? "change" : "input";
      el.addEventListener(evt, () => this._onDrawerChange(el));
    });
    this.shadowRoot.querySelector("[data-reset]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this._resetting) return;
      this._resetting = true;
      try {
        const raw = { ...this._rawConfig };
        delete raw.persist;
        try {
          window.localStorage.removeItem(this._lsKey || storageKey(raw));
        } catch {
        }
        this.setConfig(raw);
      } finally {
        this._resetting = false;
      }
      this._didFit = false;
      if (this._hass) this._update();
    });
    const clusterBtn = this.shadowRoot.querySelector("[data-cluster]");
    if (clusterBtn) {
      clusterBtn.setAttribute("aria-pressed", String(cfg.show_cluster !== false));
      clusterBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = !(this._config.show_cluster !== false);
        this._config = { ...this._config, show_cluster: next };
        this._saveRuntime();
        clusterBtn.setAttribute("aria-pressed", String(next));
        clusterBtn.querySelector("path")?.setAttribute("d", next ? ICONS.cluster : ICONS.clusterOff);
        this._update();
        this._persistConfig(this._config);
      });
    }
    const trafficBtn = this.shadowRoot.querySelector("[data-traffic]");
    if (trafficBtn) {
      trafficBtn.setAttribute(
        "aria-pressed",
        String(!!(cfg.show_traffic && String(cfg.basemap).startsWith("amap")))
      );
    }
    trafficBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = !this._config.show_traffic;
      this._config = { ...this._config, show_traffic: next };
      this._saveRuntime();
      trafficBtn.setAttribute("aria-pressed", String(next && String(this._config.basemap).startsWith("amap")));
      const traffic2 = BASEMAPS.traffic;
      const want = next && String(this._config.basemap).startsWith("amap");
      this._engine.setOverlay(
        "traffic",
        want ? { maxZoom: traffic2.maxZoom, layers: traffic2.layers.map((l) => ({ template: l.template, opacity: l.opacity })) } : null
      );
      this._syncDrawer();
      this._persistConfig(this._config);
    });
    this.shadowRoot.querySelector("[data-reset-focus]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._resetFocus();
    });
    this.shadowRoot.querySelector("[data-fit]")?.addEventListener("click", () => {
      this._didFit = false;
      this._engine._userMoved = false;
      this._update();
    });
    this.shadowRoot.querySelectorAll("[data-z]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this._engine.setZoom(this._engine.zoom + Number(b.dataset.z));
      });
    });
    this.shadowRoot.querySelector("[data-fs]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._toggleBleed();
    });
    const lockBtn = this.shadowRoot.querySelector("[data-lock]");
    if (lockBtn) {
      lockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._homeLocked = !this._homeLocked;
        lockBtn.setAttribute("aria-pressed", this._homeLocked ? "true" : "false");
        lockBtn.setAttribute("aria-label", this._homeLocked ? "解锁家位置" : "锁定家位置");
        lockBtn.querySelector("path")?.setAttribute("d", this._homeLocked ? ICONS.lock : ICONS.lockOpen);
        if (this._engine) this._engine._homeLocked = this._homeLocked;
      });
    }
    document.addEventListener("fullscreenchange", this._onFsChange = () => {
      if (document.fullscreenElement === this) this._engine?.render();
    });
    const traffic = BASEMAPS.traffic;
    const wantTraffic = !!cfg.show_traffic && String(cfg.basemap).startsWith("amap");
    this._engine.setOverlay(
      "traffic",
      wantTraffic ? { maxZoom: traffic.maxZoom, layers: traffic.layers.map((l) => ({ template: l.template, opacity: l.opacity })) } : null
    );
    this._basemapShift = base.needsShift;
    this._dark = this._resolveDark();
    this.shadowRoot.querySelector(".cmc-card")?.classList.toggle("is-dark", !!this._dark);
    if (prevView) {
      this._engine.center = prevView.c;
      this._engine.zoom = prevView.z;
      this._engine._userMoved = prevView.moved;
      if (prevView.sel && this._hass?.states?.[prevView.sel]) {
        this._engine.setSelected(prevView.sel);
      }
    }
    if (this._hass) this._update();
    else this._engine.render();
    this._engine.render();
    this._applyAspect();
    this._applyConditions();
    this._renderList();
  }
  _collectEntities() {
    const hass = this._hass;
    if (!hass) return [];
    const cfg = this._config;
    const personSources = /* @__PURE__ */ new Set();
    if (cfg.dedupe_trackers !== false) {
      Object.values(hass.states).forEach((st) => {
        if (st.entity_id.startsWith("person.") && st.attributes?.source) {
          personSources.add(st.attributes.source);
        }
      });
    }
    let ids = [];
    if (cfg.entities?.length) {
      ids = cfg.entities.map((e) => typeof e === "object" ? e.entity : e).filter(Boolean);
      const skipHiddenSrc = cfg.respect_hidden !== false && this._hiddenIds;
      cfg.entities.forEach((e) => {
        if (typeof e !== "object" || !e.source) return;
        Object.keys(hass.states).forEach((id) => {
          const d = hass.states[id];
          if (skipHiddenSrc && this._hiddenIds.has(id)) return;
          if (id.startsWith("geo_location.") && d.attributes?.source === e.source) ids.push(id);
        });
      });
    }
    if (cfg.show_all) {
      const skipHidden = cfg.respect_hidden !== false && this._hiddenIds;
      ids = Object.keys(hass.states).filter((id) => {
        const d = hass.states[id];
        if (skipHidden && this._hiddenIds.has(id)) return false;
        if (personSources.has(id)) return false;
        return d?.attributes?.latitude != null && (id.startsWith("person.") || id.startsWith("device_tracker.") || id.startsWith("geo_location."));
      });
    }
    if (cfg.geo_location_sources?.length) {
      const skipHiddenGeo = cfg.respect_hidden !== false && this._hiddenIds;
      ids.push(...Object.keys(hass.states).filter((id) => {
        const d = hass.states[id];
        if (skipHiddenGeo && this._hiddenIds.has(id)) return false;
        return id.startsWith("geo_location.") && cfg.geo_location_sources.includes(d.attributes?.source);
      }));
    }
    const hidden = new Set(cfg.hidden_entities || []);
    return [...new Set(ids)].filter((id) => !hidden.has(id)).map((id) => hass.states[id]).filter(Boolean);
  }
  /* ---- 轨迹：订阅 history/stream，按实体画折线 ---- */
  _syncTracks(states) {
    if (this._preview) return;
    const cfg = this._config;
    const hours = Number(cfg.hours_to_show) || 0;
    if (hours <= 0) {
      if (this._trackUnsub) {
        this._trackUnsub();
        this._trackUnsub = null;
      }
      this._trackSig = "";
      this._trackPoints = {};
      this._engine.clearPaths();
      return;
    }
    const ids = states.map((s) => s.entity_id).sort();
    const sig = `${hours}|${ids.join(",")}`;
    if (sig === this._trackSig) {
      this._paintTracks();
      return;
    }
    this._trackSig = sig;
    if (this._trackUnsub) {
      this._trackUnsub();
      this._trackUnsub = null;
    }
    const conn = this._hass?.connection;
    if (!conn || !conn.subscribeMessage) return;
    const start = new Date(Date.now() - hours * 3600 * 1e3).toISOString();
    this._trackPoints = {};
    Promise.resolve(
      conn.subscribeMessage(
        (msg) => {
          if (!msg?.states) return;
          Object.entries(msg.states).forEach(([id, arr]) => {
            const pts = (arr || []).map((st) => {
              const lat = st.a?.latitude, lng = st.a?.longitude;
              if (typeof lat !== "number" || typeof lng !== "number") return null;
              const raw = st.lc ?? st.last_changed ?? st.lu ?? st.last_updated ?? null;
              let t = null;
              if (typeof raw === "number") t = raw < 1e12 ? raw * 1e3 : raw;
              else if (typeof raw === "string") {
                const ms = Date.parse(raw);
                t = Number.isFinite(ms) ? ms : null;
              }
              return { lat, lng, t };
            }).filter(Boolean);
            this._trackPoints[id] = pts;
          });
          this._paintTracks();
        },
        {
          type: "history/stream",
          entity_ids: ids,
          start_time: start,
          minimal_response: false,
          significant_changes_only: false,
          no_attributes: false
        }
      )
    ).then((unsub) => {
      this._trackUnsub = unsub;
    }).catch(() => {
      this._trackUnsub = null;
    });
  }
  _paintTracks() {
    const cfg = this._config;
    const shift = this._basemapShift;
    const paths = [];
    Object.entries(this._trackPoints).forEach(([id, pts]) => {
      if (!pts || pts.length < 2) return;
      const color = this._entityConf(id)?.color || this._hass?.states?.[id]?.attributes?.color || "#03a9f4";
      paths.push({
        entityId: id,
        color,
        width: Number(cfg.track_width) || 3,
        opacity: cfg.track_opacity ?? 0.85,
        points: pts.map((p) => {
          if (!shift) return p;
          const [gl, gn] = GCJ.wgs2gcj(p.lat, p.lng);
          return { lat: gl, lng: gn, t: p.t };
        })
      });
    });
    this._engine.setPaths(paths);
  }
  /* 轨迹点悬停：显示该点的 HH:MM 与相对时间（官方轨迹 tooltip 语义） */
  _showTrackTip(info) {
    const tip = this.shadowRoot?.querySelector(".cmc-tip");
    if (!tip) return;
    if (!info || !info.t) {
      tip.hidden = true;
      return;
    }
    const d = new Date(info.t);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    tip.textContent = `${hh}:${mm} · ${this._relTime(d.toISOString())}`;
    const host = this.shadowRoot.querySelector(".cmc-card").getBoundingClientRect();
    tip.style.left = `${Math.round(info.x - host.left)}px`;
    tip.style.top = `${Math.round(info.y - host.top - 8)}px`;
    tip.hidden = false;
  }
  /* 抽屉：值同步 */
  _syncDrawer() {
    const d = this.shadowRoot.querySelector('[data-view="settings"]');
    if (!d) return;
    const c = this._config;
    d.querySelectorAll("[data-d]").forEach((el) => {
      const k = el.dataset.d;
      if (el.type === "checkbox") el.checked = c[k] === void 0 ? ["show_cluster", "show_labels", "show_status", "show_accuracy", "show_zone_radius", "show_zones", "show_all", "respect_hidden", "show_scale"].includes(k) : !!c[k];
      else if (k === "hours_to_show") el.value = String(Number(c[k]) || 0);
      else if (k === "theme_mode") el.value = c[k] || "auto";
      else if (k === "label_mode") el.value = c[k] || "name";
      else el.value = c[k] === void 0 ? "" : c[k];
    });
    const bm = c.basemap || "amap";
    d.querySelectorAll("[data-d-row]").forEach((el) => {
      el.style.display = el.dataset.dRow.split(" ").includes(bm) ? "" : "none";
    });
    const home = this._hass?.states?.["zone.home"]?.attributes || {};
    const ph = (k, v) => {
      const el = d.querySelector(`[data-d="${k}"]`);
      if (el && c[k] == null) el.placeholder = v == null ? "" : String(v);
    };
    ph("home_lat", typeof home.latitude === "number" ? home.latitude.toFixed(6) : "");
    ph("home_lng", typeof home.longitude === "number" ? home.longitude.toFixed(6) : "");
    ph("home_radius", typeof home.radius === "number" ? home.radius : "");
    this._renderEntityPicker();
  }
  /* 设置里的实体清单：人 / 设备 / 区域，逐个勾选是否上图 */
  _renderEntityPicker() {
    const box = this.shadowRoot?.querySelector("[data-ent-list]");
    if (!box) return;
    const hass = this._hass, cfg = this._config;
    const cnt = this.shadowRoot.querySelector("[data-ent-count]");
    if (!hass) {
      box.innerHTML = "";
      if (cnt) cnt.textContent = "";
      return;
    }
    const hidden = new Set(cfg.hidden_entities || []);
    const explicit = (cfg.entities || []).map((e) => typeof e === "object" ? e.entity : e).filter(Boolean);
    const showAll = cfg.show_all !== false;
    const nameOf = (st) => st.attributes?.friendly_name || st.entity_id;
    const groups = [["person.", "人员"], ["device_tracker.", "设备"], ["zone.", "区域"]];
    let html = "", total = 0;
    groups.forEach(([pre, label]) => {
      const rows = Object.values(hass.states).filter((st) => st.entity_id.startsWith(pre) && st.attributes?.latitude != null).sort((a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)), "zh"));
      if (!rows.length) return;
      total += rows.length;
      html += `<div class="cmc-ent-group">${label}（${rows.length}）</div>`;
      rows.forEach((st) => {
        const id = st.entity_id;
        const on = id.startsWith("zone.") ? cfg.show_zones !== false && !hidden.has(id) : !hidden.has(id) && (showAll || explicit.includes(id));
        html += `<label class="cmc-ent"><input type="checkbox" data-ent="${escapeAttr(id)}"${on ? " checked" : ""}><span class="cmc-ent-n">${escapeHtml(nameOf(st))}</span><span class="cmc-ent-id">${escapeHtml(id)}</span></label>`;
      });
    });
    box.innerHTML = html || '<div class="cmc-empty">没有可定位实体</div>';
    if (cnt) cnt.textContent = total ? `共 ${total} 个` : "";
  }
  /* 勾选/取消一个实体：写 entities（自定义模式）或 hidden_entities（全部模式） */
  _toggleEntity(id, on) {
    const cfg = { ...this._config };
    const hidden = new Set(cfg.hidden_entities || []);
    const eid = (e) => typeof e === "object" ? e.entity : e;
    if (id.startsWith("zone.")) {
      if (on) {
        hidden.delete(id);
        cfg.show_zones = true;
      } else hidden.add(id);
    } else if (cfg.show_all === false) {
      const ents = (cfg.entities || []).slice();
      if (on) {
        hidden.delete(id);
        if (!ents.some((e) => eid(e) === id)) ents.push(id);
      } else {
        hidden.add(id);
        cfg.entities = ents.filter((e) => eid(e) !== id);
      }
      cfg.entities = ents;
    } else if (on) hidden.delete(id);
    else hidden.add(id);
    cfg.hidden_entities = [...hidden];
    this._config = cfg;
    this._saveRuntime();
    this._persistConfig(cfg);
    Promise.resolve().then(() => {
      this._update();
      this._renderEntityPicker();
    });
  }
  /* 家庭地址解析：支持 “纬度,经度” 直填，或高德 Web 服务 Key 地理编码 */
  async _geocodeHome() {
    const cfg = { ...this._config };
    const hint = this.shadowRoot?.querySelector("[data-geo-hint]");
    const addr = String(cfg.home_address || "").trim();
    const setHint = (t) => {
      if (hint) hint.textContent = t;
    };
    if (!addr) {
      setHint("先填地址，或直接填“纬度,经度”");
      return;
    }
    const m = addr.match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
    let lat, lng;
    if (m) {
      lat = Number(m[1]);
      lng = Number(m[2]);
      if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
    } else {
      const key = String(cfg.amap_key || "").trim();
      if (!key) {
        setHint("地址解析需要高德 Web 服务 Key；也可直接填“纬度,经度”");
        return;
      }
      try {
        const r = await fetch(`https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(key)}&address=${encodeURIComponent(addr)}`);
        const j = await r.json();
        const loc = j?.geocodes?.[0]?.location;
        if (!loc) {
          setHint(`解析失败：${j?.info || "无结果"}`);
          return;
        }
        [lng, lat] = String(loc).split(",").map(Number);
      } catch {
        setHint("地址服务不可达，请直接填经纬度");
        return;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setHint("坐标不合法");
      return;
    }
    cfg.home_lat = Number(lat.toFixed(6));
    cfg.home_lng = Number(lng.toFixed(6));
    this._config = cfg;
    this._saveRuntime();
    this._persistConfig(cfg);
    const d = this.shadowRoot.querySelector('[data-view="settings"]');
    if (d) {
      const a = d.querySelector('[data-d="home_lat"]'), b = d.querySelector('[data-d="home_lng"]');
      if (a) a.value = String(cfg.home_lat);
      if (b) b.value = String(cfg.home_lng);
    }
    setHint(`已定位：${cfg.home_lat}, ${cfg.home_lng}`);
    Promise.resolve().then(() => this._update());
  }
  _syncHomeFields() {
    const d = this.shadowRoot?.querySelector('[data-view="settings"]');
    if (!d) return;
    const cfg = this._config || {};
    const a = d.querySelector('[data-d="home_lat"]');
    const b = d.querySelector('[data-d="home_lng"]');
    const r = d.querySelector('[data-d="home_radius"]');
    if (a) a.value = cfg.home_lat ?? "";
    if (b) b.value = cfg.home_lng ?? "";
    if (r) r.value = cfg.home_radius ?? "";
  }
  _setGeoHint(t) {
    const h = this.shadowRoot?.querySelector("[data-geo-hint]");
    if (h) h.textContent = t;
  }
  /* 同步到 HA 核心「我的家」（设置 → 区域与地点 → 我的家）。
     HA 2024.10+ 移除了 zone.edit 服务；实测 WS config/core/update 可以直接写
     latitude/longitude/radius 并落到 zone.home 实体，不需要 config entry。 */
  async _syncHomeToZone(patch, done) {
    this._saveRuntime();
    this._persistConfig(this._config);
    this._setGeoHint(done);
    try {
      await this._hass.callWS({ type: "config/core/update", ...patch });
      const next = { ...this._config };
      delete next.home_lat;
      delete next.home_lng;
      delete next.home_radius;
      this._config = next;
      this._saveRuntime();
      this._persistConfig(next);
      this._setGeoHint(`${done}（已同步到家区域）`);
      Promise.resolve().then(() => this._update());
    } catch (err) {
      console.warn("[ha-cn-map-card] config/core/update failed:", err);
      this._setGeoHint(`${done}（同步到 HA 失败：${err?.message || err}）`);
      Promise.resolve().then(() => this._update());
    }
  }
  /* 地图上拖动家里的小房子：高德底图坐标 → WGS84 后写进 home_lat/home_lng */
  _onHomeDrag(d) {
    if (!d || d.entityId !== "zone.home") return;
    if (d.phase === "start") {
      this._engine._userMoved = true;
      return;
    }
    let lat = d.lat, lng = d.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (this._basemapShift) [lat, lng] = GCJ.gcj2wgs(lat, lng);
    lat = Number(lat.toFixed(6));
    lng = Number(lng.toFixed(6));
    this._config = { ...this._config, home_lat: lat, home_lng: lng };
    this._syncHomeFields();
    if (d.phase === "end") {
      this._syncHomeToZone({ latitude: lat, longitude: lng }, `家已挪到：${lat}, ${lng}`);
    }
  }
  /* 拖动半径圈手柄：米数直接写 home_radius */
  _onHomeRadius(d) {
    if (!d || d.entityId !== "zone.home") return;
    if (d.phase !== "start" && Number.isFinite(d.radius)) {
      const r = Math.round(d.radius);
      if (!Number.isFinite(r) || r < 20 || r > 1e5) return;
      this._config = { ...this._config, home_radius: r };
      this._syncHomeFields();
    }
    if (d.phase === "end") {
      this._engine._userMoved = true;
      const r = Math.round(d.radius);
      if (!Number.isFinite(r) || r < 20 || r > 1e5) return;
      this._syncHomeToZone({ radius: r }, `家半径已设为：${r} 米`);
    }
  }
  /* 抽屉：改配置 → 立即重绘 + 存到本浏览器 + 通知外部 */
  _onDrawerChange(el) {
    const k = el.dataset.d;
    let v;
    if (el.type === "checkbox") v = el.checked;
    else if (k === "hours_to_show") v = Number(el.value) || 0;
    else v = el.value;
    const cfg = { ...this._config };
    if (k === "show_all" && v === false) {
      const keep = (cfg.entities || []).filter((e) => typeof e === "object");
      const objs = new Map(keep.map((o) => [o.entity, o]));
      cfg.entities = this._collectEntities().map((st) => objs.get(st.entity_id) || st.entity_id);
    }
    if (el.type === "checkbox") {
      cfg[k] = v;
    } else if (k === "hours_to_show") {
      cfg[k] = Number(v) || 0;
    } else if (["home_lat", "home_lng", "home_radius"].includes(k)) {
      if (v === "" || v == null) delete cfg[k];
      else cfg[k] = Number(v);
    } else if (v === "") {
      delete cfg[k];
    } else {
      cfg[k] = v;
    }
    this._config = cfg;
    this._saveRuntime();
    const rebuild = ["basemap", "theme_mode", "tianditu_key", "show_traffic", "hours_to_show", "height"].includes(k);
    if (rebuild) {
      Promise.resolve().then(() => {
        this._render();
        this._panelOpen = true;
        this._panelUserClosed = false;
        this._setPanelOpen?.(true);
        this._setPanelView?.("settings");
      });
    } else {
      Promise.resolve().then(() => this._update());
    }
    this._persistConfig(cfg);
  }
  /* 卡片内改配置：如果 HA 给了 setConfig 能力就回写，否则只影响本次显示 */
  _persistConfig(cfg) {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: cfg },
        bubbles: true,
        composed: true
      })
    );
  }
  disconnectedCallback() {
    if (this._trackUnsub) {
      this._trackUnsub();
      this._trackUnsub = null;
    }
    if (this._onFsChange) document.removeEventListener("fullscreenchange", this._onFsChange);
    if (this._onKeyBleed) this.removeEventListener("keydown", this._onKeyBleed);
    if (this._onDocKey) {
      document.removeEventListener("keydown", this._onDocKey);
      this._onDocKey = null;
    }
    if (this._onPop) {
      window.removeEventListener("popstate", this._onPop);
      this._onPop = null;
    }
    if (this._onLoc) {
      window.removeEventListener("location-changed", this._onLoc);
      this._onLoc = null;
    }
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
    if (this._mq && this._onMq) {
      this._mq.removeEventListener?.("change", this._onMq);
      this._mq = null;
      this._onMq = null;
    }
  }
  connectedCallback() {
    if (!this._onPop) {
      this._onPop = () => this._syncUrlSelection();
      window.addEventListener("popstate", this._onPop);
    }
    if (!this._onLoc) {
      this._onLoc = () => this._syncUrlSelection();
      window.addEventListener("location-changed", this._onLoc);
    }
    if (!this._onDocKey) {
      this._onDocKey = (e) => {
        if (e.key !== "Escape") return;
        if (this._panelView === "detail") {
          this._engine?.setSelected(null);
          this._writeSelection(null);
          this._setPanelView?.("list");
          this._renderList?.();
          e.preventDefault();
        } else if (this.classList.contains("cmc-bleed") && this._bleedUser !== false) {
          this._bleedUser = false;
          this._applyBleed(false);
        }
      };
      document.addEventListener("keydown", this._onDocKey);
    }
    if (typeof ResizeObserver === "function" && !this._ro) {
      this._ro = new ResizeObserver(() => {
        const layoutNow = this._resolveLayout();
        if (layoutNow !== this._layout) {
          this._syncLayout();
        } else {
          this._syncBleed();
          this._engine?.render();
        }
      });
      this._ro.observe(this);
    }
    if (typeof window.matchMedia === "function" && !this._mq) {
      this._mq = window.matchMedia("(max-width: 600px)");
      this._onMq = () => {
        if (this._mq.matches === this._phone) return;
        this._render();
        if (this._hass) this._update();
      };
      this._mq.addEventListener?.("change", this._onMq);
    }
    Promise.resolve().then(() => this._syncBleed());
  }
  /* 布局变了（panel 视图赋值 / 尺寸变化）时重建，并保住当前视野 */
  _syncLayout() {
    const view = this._engine ? { c: this._engine.center, z: this._engine.zoom } : null;
    this._layout = this._resolveLayout();
    this._isFull = this._layout === LAYOUT.FULL;
    this._render();
    if (view && this._engine) {
      this._engine.center = view.c;
      this._engine.zoom = view.z;
      this._engine.render();
    }
    if (this._hass) this._update();
  }
  /* 打开实体详情弹窗。
     HA 没有 homeassistant.more_info 这个服务（已对实例实测：该域只有 turn_on /
     toggle / restart 等），旧代码 callService 属于静默失败。正确做法与官方一致：
     发 hass-more-info 事件，composed 才能穿出 shadow root 被 lovelace 接住。 */
  _openMoreInfo(entityId, settings) {
    if (!entityId) return;
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = settings ? { entityId, view: "settings" } : { entityId };
    this.dispatchEvent(ev);
  }
  /* 详情页「导航」：官方 navigationUrl 同款语义，桌面端换成国内可达的高德网页版 */
  _openDirections() {
    const st = this._hass?.states?.[this._detailEntity];
    const lat = st?.attributes?.latitude;
    const lng = st?.attributes?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return;
    const point = `${lat},${lng}`;
    const ua = String(navigator.userAgent || "");
    let url;
    if (/iPhone|iPad|iPod/i.test(ua) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
      url = `https://maps.apple.com/?daddr=${point}`;
    } else if (/Android/i.test(ua)) {
      url = `geo:${point}?q=${point}`;
    } else {
      url = `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(
        st.attributes.friendly_name || this._detailEntity
      )}&coordinate=wgs84&callnative=1&src=ha-map-cn`;
    }
    window.open(url, "_blank", "noreferrer");
  }
  /* 聚焦缩放：只放大到"和最近的其它标记拉开 80px"为止（官方 FOCUS_CLEARANCE_PX），
     上限 17 级。人多且挨得近时不会一杆戳到街景级；单独一个实体才允许明显拉近。 */
  _focusZoom(lat, lng, base) {
    const n = 2 ** base;
    const c = CnTileEngine.project(lat, lng);
    let nearest = Infinity;
    (this._lastMarkers || []).forEach((m) => {
      const p = CnTileEngine.project(m.lat, m.lng);
      const d = Math.hypot((p.x - c.x) * n * 256, (p.y - c.y) * n * 256);
      if (d > 0.5) nearest = Math.min(nearest, d);
    });
    if (!Number.isFinite(nearest)) return Math.min(17, base + 2);
    return Math.max(base, Math.min(17, base + Math.log2(80 / nearest)));
  }
  /* 聚焦实体：官方点击标记 / 点击列表项的"选中 + 飞行"语义。
     全屏且面板展开时，把目标点放在让开面板后的可视区域中心 */
  /* URL 深链：?entity_id=person.zhangsan / ?entity=… / #person.zhangsan 都可。
     用途是把「某人现在在哪」做成可分享的链接；只读不写回，免得污染用户地址栏 */
  _applyUrlSelection() {
    if (this._urlApplied || !this._hass) return;
    let raw = "";
    try {
      const q = new URLSearchParams(window.location.search);
      raw = q.get("entity_id") || q.get("entity") || "";
    } catch (_) {
    }
    const hash = String(window.location.hash || "").replace(/^#/, "");
    if (!raw && hash) {
      if (hash.includes("=")) {
        try {
          const hp = new URLSearchParams(hash);
          raw = hp.get("entity_id") || hp.get("entity") || "";
        } catch (_) {
        }
      } else if (/^(person|device_tracker|zone|geo_location)\./.test(hash)) {
        raw = hash;
      }
    }
    if (!raw) return;
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch (_) {
    }
    const st = this._hass.states[id];
    if (!st || typeof st.attributes.latitude !== "number") return;
    this._urlApplied = true;
    this.focusEntity(id);
  }
  /* 选中态写回地址栏（对齐官方 SELECTED_ENTITY_PARAM = "entity_id"）。
     v1.0.6 起这里只读不写；v1.1.9 改成双向：选中即写，刷新/分享/后退都能还原。
     用 replaceState 而不是 pushState——自定义卡片不在 HA 的导航链路里，
     推历史会让「后退」落到卡片不认识的中间态；替换当前记录已足够。 */
  _writeSelection(entityId) {
    if (!this._isFull || this._preview) return;
    try {
      const u = new URL(window.location.href);
      if (entityId) u.searchParams.set("entity_id", entityId);
      else u.searchParams.delete("entity_id");
      const next = u.pathname + u.search + u.hash;
      const cur = window.location.pathname + window.location.search + window.location.hash;
      if (next !== cur) window.history.replaceState(window.history.state, "", next);
    } catch (_) {
    }
  }
  /* 地址栏变化（浏览器后退/前进、别的组件改参数）时回填选中态 */
  _syncUrlSelection() {
    if (!this._isFull || !this._hass) return;
    let raw = "";
    try {
      raw = new URLSearchParams(window.location.search).get("entity_id") || "";
    } catch (_) {
    }
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch (_) {
    }
    if (!id || !/^(person|device_tracker|zone|geo_location)\./.test(id)) {
      if (this._engine?._selectedEntity) {
        this._engine.setSelected(null);
        if (this._panelView === "detail") this._setPanelView?.("list");
        this._renderList?.();
      }
      return;
    }
    if (this._engine?._selectedEntity === id) return;
    if (this._hass.states[id]) this.focusEntity(id);
  }
  focusEntity(entityId, zoom) {
    const st = this._hass?.states?.[entityId];
    if (!st || typeof st.attributes.latitude !== "number") return;
    let lat = st.attributes.latitude, lng = st.attributes.longitude;
    if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
    this._engine.setSelected(entityId);
    this._writeSelection(entityId);
    this._showDetail(entityId);
    this._userSelected = true;
    this._engine._userMoved = true;
    const z = Math.max(Number(zoom ?? 0) || 16, 16);
    let offX = 0, offY = 0;
    if (this._isFull && this._panelOpen) {
      const dockBottom = window.innerWidth <= 600;
      const pad = this._fitPadding();
      if (dockBottom) offY = -pad * 0.35;
      else offX = -pad * 0.35;
    }
    const mPerLng = 360 / (2 ** z * 256);
    const mPerLat = mPerLng / Math.cos(lat * Math.PI / 180);
    this._engine.flyTo(lat + offY * mPerLat, lng + offX * mPerLng, z, 550, { forceZoom: true });
  }
  /* ---- 实体详情（最近活动）---- */
  _showDetail(entityId) {
    if (!this._hass?.states?.[entityId]) return;
    const changed = this._detailEntity !== entityId;
    this._detailEntity = entityId;
    this._setPanelView?.("detail");
    this._setPanelOpen?.(true);
    this._panelUserClosed = false;
    this._renderDetailHeader();
    if (changed || !this._actEntries) this._loadActivity(entityId);
  }
  _renderDetailHeader() {
    const st = this._hass?.states?.[this._detailEntity];
    if (!st) return;
    const nameEl = this.shadowRoot.querySelector("[data-det-name]");
    const subEl = this.shadowRoot.querySelector("[data-det-sub]");
    if (!nameEl || !subEl) return;
    nameEl.textContent = st.attributes.friendly_name || this._detailEntity;
    const rel = this._relTime(st.last_updated || st.last_changed);
    let state;
    if (this._detailEntity.startsWith("zone.")) {
      const n = Number(st.state);
      state = Number.isNaN(n) ? "" : `${n} 人在此`;
    } else if (OFFLINE_STATES.has(String(st.state).toLowerCase())) {
      state = "离线";
    } else {
      const z = this._zoneForState(st, this._listEntries().zones);
      state = z ? `在 ${z.attributes.friendly_name || "区域"}` : st.state === "not_home" ? "离家" : st.state === "home" ? "在家" : st.state;
    }
    subEl.textContent = rel && state ? `${state} · ${rel}` : state || rel;
    const navEl = this.shadowRoot.querySelector("[data-det-nav]");
    const setEl = this.shadowRoot.querySelector("[data-det-set]");
    if (navEl) {
      navEl.hidden = !(typeof st.attributes.latitude === "number" && typeof st.attributes.longitude === "number");
    }
    if (setEl) setEl.hidden = !this._hass?.user?.is_admin;
  }
  /* 最近 24h 活动时间线：官方 ACTIVITY_HOURS=24 / 最多 20 条 / 默认显示 5 条 */
  static ACTIVITY_MAX = 20;
  async _loadActivity(entityId) {
    const req = this._actReq = (this._actReq || 0) + 1;
    const bodyEl = this.shadowRoot.querySelector("[data-activity]");
    if (!bodyEl) return;
    this._actFailed = false;
    this._actEntries = null;
    this._actExpanded = false;
    bodyEl.innerHTML = `<div class="cmc-act-empty">加载中…</div>`;
    const isZone = entityId.startsWith("zone.");
    const ids = isZone ? this._listEntries().people.map((s) => s.entity_id) : [entityId];
    if (!ids.length) {
      this._actEntries = [];
      this._renderActivity();
      return;
    }
    let history;
    try {
      history = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(Date.now() - 24 * 3600 * 1e3).toISOString(),
        end_time: (/* @__PURE__ */ new Date()).toISOString(),
        entity_ids: ids,
        minimal_response: false,
        no_attributes: false
      });
    } catch {
      history = null;
    }
    if (req !== this._actReq) return;
    this._actFailed = history === null;
    this._actEntries = this._computeActivity(entityId, history, isZone, ids);
    this._renderActivity();
  }
  _computeActivity(entityId, history, isZone, personIds) {
    const NO_LOC = ["unavailable", "unknown"];
    const since = Date.now() - 24 * 3600 * 1e3;
    const out = [];
    if (isZone) {
      for (const pid of personIds) {
        const person = this._hass?.states?.[pid];
        let wasIn;
        for (const e of history?.[pid] || []) {
          if (NO_LOC.includes(e.s)) continue;
          const inZone = Array.isArray(e.a?.in_zones) ? e.a.in_zones.includes(entityId) : false;
          const isEvent = wasIn === void 0 ? inZone : inZone !== wasIn;
          if (isEvent && e.lu * 1e3 >= since) {
            out.push({ entityId: pid, name: person?.attributes?.friendly_name || pid, picture: person?.attributes?.entity_picture, when: e.lu * 1e3, arrived: inZone });
          }
          wasIn = inZone;
        }
      }
      out.sort((a, b) => b.when - a.when);
    } else {
      let prev;
      for (const e of history?.[entityId] || []) {
        if (NO_LOC.includes(e.s)) continue;
        if (e.s === prev) continue;
        prev = e.s;
        if (e.lu * 1e3 < since) continue;
        out.push({ entityId, state: e.s, when: e.lu * 1e3 });
      }
      out.reverse();
    }
    return out.slice(0, _HaCnMapCard.ACTIVITY_MAX);
  }
  _renderActivity() {
    const bodyEl = this.shadowRoot.querySelector("[data-activity]");
    if (!bodyEl) return;
    if (this._actFailed) {
      bodyEl.innerHTML = `<div class="cmc-act-empty">活动记录不可用</div>`;
      return;
    }
    const list = this._actEntries;
    if (!list || !list.length) {
      bodyEl.innerHTML = `<div class="cmc-act-empty">最近 24 小时没有活动</div>`;
      return;
    }
    const shown = this._actExpanded ? list : list.slice(0, 5);
    const hhmm = (t) => {
      const d = new Date(t);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const rows = shown.map((en) => {
      let hl, prefix = "";
      if (en.arrived !== void 0) {
        hl = escapeHtml(en.name);
        prefix = en.arrived ? "进入" : "离开";
      } else {
        hl = escapeHtml(this._activityHeadline(en.state));
      }
      const ent = this._hass?.states?.[en.entityId];
      const nm = en.name || ent?.attributes?.friendly_name || en.entityId;
      const pic = en.picture || ent?.attributes?.entity_picture;
      const av = pic ? `<img src="${escapeAttr(pic)}" referrerpolicy="no-referrer" alt="">` : this._initial(nm);
      return `<div class="cmc-act-row">
        <span class="cmc-act-av" data-i="${escapeAttr(this._initial(nm))}">${av}</span>
        <span class="cmc-act-tx">
          <span class="cmc-act-hl">${hl}</span>
          <span class="cmc-act-when">${prefix ? `${prefix} · ` : ""}${hhmm(en.when)} · ${escapeHtml(this._relTime(en.when) || "刚刚")}</span>
        </span>
      </div>`;
    });
    bodyEl.innerHTML = `<div class="cmc-act-body-inner">${rows.join("")}</div>${list.length > shown.length ? `<button class="cmc-act-more" data-act-more type="button">显示全部 ${list.length} 条</button>` : ""}`;
    bodyEl.querySelector("[data-act-more]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._actExpanded = true;
      this._renderActivity();
    });
    bodyEl.querySelectorAll(".cmc-act-av img").forEach((img) => {
      img.addEventListener("error", () => {
        const box = img.parentElement;
        box.textContent = box.dataset.i || "?";
      });
    });
  }
  /* 状态值 → 人话：zone object_id / home / not_home / 其它 */
  _activityHeadline(state) {
    const s = String(state);
    if (s === "home") return "在家";
    if (s === "not_home") return "离家";
    const z = this._hass?.states?.[`zone.${s}`];
    if (z) return `在 ${z.attributes?.friendly_name || s}`;
    return s;
  }
  /* ---- 条件显示（官方条件卡片语义）----
     conditions: [{entity, state?, state_not?, attribute?}]，全部满足才显示。
     entity 不存在视为不满足；空/缺省永远显示。attribute 存在时比较属性值而非状态 */
  _meetsConditions() {
    const cs = this._config?.conditions;
    const hass = this._hass;
    if (!Array.isArray(cs) || !cs.length || !hass) return true;
    return cs.every((c) => {
      const st = c?.entity ? hass.states[c.entity] : null;
      if (!st) return false;
      const val = c.attribute != null ? String(st.attributes?.[c.attribute]) : String(st.state);
      if (c.state != null && val !== String(c.state)) return false;
      if (c.state_not != null && val === String(c.state_not)) return false;
      return true;
    });
  }
  /* 评估条件并切换整卡可见性；返回 true = 当前隐藏，_update 不必再走渲染 */
  _applyConditions() {
    const ok = this._meetsConditions();
    if (typeof this.style !== "undefined") this.style.display = ok ? "" : "none";
    return !ok;
  }
  /* 查某实体的逐实体配置：entities 条目既可按 entity 精确点名，
     也可用 {source: "xxx"} 匹配指定来源的 geo_location 实体（v1.1.5） */
  _entityConf(entityId) {
    const st = this._hass?.states?.[entityId];
    return (this._config?.entities || []).find(
      (e) => typeof e !== "object" ? e === entityId : e.entity ? e.entity === entityId : e.source ? entityId.startsWith("geo_location.") && st?.attributes?.source === e.source : false
    );
  }
  _update() {
    if (this._applyConditions()) return;
    const hass = this._hass, cfg = this._config;
    const scaleEl = this.shadowRoot.querySelector(".cmc-scale");
    if (scaleEl) scaleEl.style.display = cfg.show_scale === false ? "none" : "";
    const states = this._collectEntities();
    const markers = [];
    const pts = [];
    states.forEach((s) => {
      const { latitude, longitude, friendly_name } = s.attributes;
      if (latitude == null) return;
      let lat = latitude, lng = longitude;
      if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
      const pic = s.attributes.entity_picture;
      const domain = s.entity_id.split(".")[0];
      const domainIcon = domain === "person" ? "mdi:account" : domain === "device_tracker" ? "mdi:cellphone-marker" : "mdi:map-marker";
      const icon = s.attributes.icon || domainIcon;
      const conf = this._entityConf(s.entity_id);
      const name = conf?.name || friendly_name || s.entity_id;
      const color = conf?.color || s.attributes.color || (domain === "person" ? "#58a6f0" : "#8bc34a");
      markers.push({
        lat,
        lng,
        entityId: s.entity_id,
        picture: pic || "",
        color,
        short: name,
        clusterable: true,
        icon,
        label: cfg.show_labels === false ? "" : this._markerLabel(s, conf, cfg, name),
        sub: cfg.show_status === false ? "" : this._markerSub(s, states),
        offline: OFFLINE_STATES.has(String(s.state).toLowerCase())
      });
      pts.push({ lat, lng });
    });
    const zoneCircles = [];
    if (cfg.show_zones) {
      Object.values(hass.states).filter((s) => s.entity_id.startsWith("zone.")).forEach((z) => {
        const { latitude, longitude, friendly_name, passive, radius } = z.attributes;
        if (latitude == null || passive) return;
        if ((cfg.hidden_entities || []).includes(z.entity_id)) return;
        let lat = latitude, lng = longitude, radiusAttr = radius;
        if (z.entity_id === "zone.home") {
          if (cfg.home_lat != null && cfg.home_lat !== "" && cfg.home_lng != null && cfg.home_lng !== "") {
            lat = Number(cfg.home_lat);
            lng = Number(cfg.home_lng);
          }
          if (cfg.home_radius != null && cfg.home_radius !== "" && Number(cfg.home_radius) > 0) {
            radiusAttr = Number(cfg.home_radius);
          }
        }
        if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
        const name = friendly_name || z.entity_id;
        markers.push({
          lat,
          lng,
          entityId: z.entity_id,
          short: name,
          label: cfg.show_labels === false ? "" : name,
          clusterable: false,
          // 家/区域不参与聚合，永远单独显示
          home: true,
          draggable: z.entity_id === "zone.home",
          // 只能拖家（其他区域没有对应的覆盖配置）
          icon: z.attributes.icon || "mdi:home"
        });
        pts.push({ lat, lng });
        const r = Number(radiusAttr);
        if (cfg.show_zone_radius !== false && Number.isFinite(r) && r > 0) {
          zoneCircles.push({
            entityId: z.entity_id,
            lat,
            lng,
            radius: r,
            color: this._zoneColor(z),
            dashed: true,
            fillOpacity: 0.12,
            strokeOpacity: 0.55,
            strokeWidth: 2,
            handle: z.entity_id === "zone.home"
            // 家半径圈带一个可拖动的小手柄
          });
          if (cfg.fit_zones) {
            const dLat = r / 111320;
            const dLng = r / (111320 * Math.cos(lat * Math.PI / 180));
            pts.push({ lat: lat + dLat, lng }, { lat: lat - dLat, lng });
            pts.push({ lat, lng: lng + dLng }, { lat, lng: lng - dLng });
          }
        }
      });
    }
    this._lastMarkers = markers;
    this._engine.setMarkers(markers, { cluster: cfg.show_cluster !== false });
    this._syncTracks(states);
    const circles = [...zoneCircles];
    if (cfg.show_accuracy !== false) {
      states.forEach((s) => {
        const acc = Number(s.attributes.gps_accuracy);
        const { latitude, longitude } = s.attributes;
        if (!Number.isFinite(acc) || acc <= 0 || latitude == null) return;
        if (s.entity_id.startsWith("zone.")) return;
        let clat = latitude, clng = longitude;
        if (this._basemapShift) [clat, clng] = GCJ.wgs2gcj(clat, clng);
        const color = this._entityConf(s.entity_id)?.color || s.attributes.color || (s.entity_id.split(".")[0] === "person" ? "#58a6f0" : "#8bc34a");
        circles.push({ entityId: s.entity_id, lat: clat, lng: clng, radius: acc, color });
      });
    }
    this._engine.setAccuracyCircles(circles);
    if (cfg.fit_entities && pts.length && !this._didFit && !this._engine._userMoved) {
      this._engine.fitBounds(pts, this._fitPadding());
      this._didFit = true;
    } else if (!this._didFit) {
      this._engine.render();
    }
    this._applyUrlSelection();
    if (!this._urlApplied && !this._focusApplied) {
      const fe = (cfg.entities || []).find((e) => typeof e === "object" && e.focus && e.entity);
      if (fe && this._hass.states[fe.entity]?.attributes?.latitude != null) {
        this._focusApplied = true;
        this.focusEntity(fe.entity);
      }
    }
    if (this._panelView === "detail" && this._detailEntity && this._engine._selectedEntity !== this._detailEntity) {
      this._engine.setSelected(this._detailEntity);
    }
    if (this._panelView === "detail") this._renderDetailHeader();
    else if (this._panelView !== "settings") this._renderList();
  }
  /* 自动适配时的内边距：全屏 + 面板展开时避开面板覆盖区
     （padding 会从可用宽高里扣两次，所以必须 clamp，否则会算出负数把缩放压到 3 级） */
  _isPhone() {
    try {
      return window.matchMedia("(max-width: 600px)").matches;
    } catch {
      return false;
    }
  }
  _fitPadding() {
    const w = this._engine?.container.clientWidth || 400;
    const h = this._engine?.container.clientHeight || 300;
    const base = Math.round(Math.min(w, h) * 0.08);
    if (this._phone) {
      const sheetH = Number(this._sheetH) || Number(this._sheetHalf) || 0;
      const pad2 = sheetH ? Math.round(sheetH * 0.95) : Math.round(h * 0.45);
      const bottom = Math.max(base, Math.min(pad2, Math.floor(h * 0.75)));
      return { top: base, right: base, bottom, left: base };
    }
    if (!this._isFull || !this._panelOpen) return base;
    const pad = Math.round(w * 0.28) + 12;
    return Math.max(base, Math.min(pad, Math.floor(Math.min(w, h) * 0.35)));
  }
  _cfgHidden() {
    return Array.isArray(this._config?.hidden_entities) ? this._config.hidden_entities : [];
  }
  /* ---- 概览列表（对齐官方 hui-map-overview 的分组与文案） ---- */
  _listEntries() {
    const hass = this._hass;
    if (!hass) return { people: [], devices: [], zones: [] };
    const ids = new Set(this._collectEntities().map((e) => e.entity_id));
    const people = [], devices = [], zones = [];
    const hiddenIds = this._cfgHidden();
    Object.values(hass.states).forEach((st) => {
      if (!st.entity_id.startsWith("person.")) return;
      if (hiddenIds.includes(st.entity_id)) return;
      if (this._config.respect_hidden !== false && this._hiddenIds?.has(st.entity_id)) return;
      people.push(st);
    });
    ids.forEach((id) => {
      const st = hass.states[id];
      if (!st) return;
      if (id.startsWith("device_tracker.") || id.startsWith("geo_location.")) devices.push(st);
    });
    Object.values(hass.states).forEach((st) => {
      if (st.entity_id.startsWith("zone.") && !st.attributes.passive) zones.push(st);
    });
    const hasLoc = (st) => st.attributes.latitude != null;
    people.sort((a, b) => (hasLoc(b) ? 1 : 0) - (hasLoc(a) ? 1 : 0));
    devices.sort((a, b) => (hasLoc(b) ? 1 : 0) - (hasLoc(a) ? 1 : 0));
    return { people, devices, zones };
  }
  /* 标记下方的短状态行：对齐官方 hui-map-marker 的副标题语义
     优先级：离线 > 区域名（在家/在公司）> 速度 > 电量 > 离家 > 相对时间 */
  /* 官方 label_mode 语义：name（默认）| state | attribute | none。
     每实体配置（entities 里的对象）优先于全局；attribute 模式取 conf.attribute */
  _markerLabel(st, conf, cfg, name) {
    const mode = conf?.label_mode || cfg.label_mode || "name";
    if (mode === "none") return "";
    if (mode === "state") {
      const raw = String(st.state ?? "");
      if (!raw || raw === "unknown" || raw === "unavailable") return name;
      let v = raw, formatted = false;
      try {
        if (typeof this._hass?.formatEntityState === "function") {
          v = this._hass.formatEntityState(st);
          formatted = v !== raw;
        }
      } catch (_) {
      }
      const unit = conf?.unit || st.attributes.unit_of_measurement || "";
      return !formatted && unit && /^[\d.,+-]+$/.test(v) ? `${v} ${unit}` : v;
    }
    if (mode === "attribute") {
      const attr = conf?.attribute;
      const raw = attr ? st.attributes[attr] : null;
      if (raw == null || raw === "") return name;
      const unit = conf?.unit || (attr === "battery" ? "%" : "");
      return unit ? `${raw} ${unit}` : String(raw);
    }
    return name;
  }
  _markerSub(st, all) {
    const state = String(st.state ?? "").toLowerCase();
    if (OFFLINE_STATES.has(state)) return "离线";
    const a = st.attributes || {};
    if (st.entity_id.startsWith("zone.")) return "";
    if (state && state !== "not_home" && state !== "home") {
      const z = all.find((s) => s.entity_id === `zone.${state}`);
      if (z) return z.attributes?.friendly_name || state;
    }
    if (state === "home") return "在家";
    const kmh = Number(a.speed);
    if (Number.isFinite(kmh) && kmh > 0) {
      const v = a.speed_unit === "mph" ? `${Math.round(kmh)} mph` : `${Math.round(kmh * 3.6)} km/h`;
      return v;
    }
    const bat = Number(a.battery_level ?? a.battery);
    if (Number.isFinite(bat) && bat >= 0 && bat <= 100 && a.battery_level != null) return `电量 ${Math.round(bat)}%`;
    if (state === "not_home") {
      const rel = this._relTime(st.last_updated || st.last_changed);
      return rel ? `离家 · ${rel}` : "离家";
    }
    return this._relTime(st.last_updated || st.last_changed);
  }
  /* 区域配色：官方 zoneColor —— 家取主色，非被动区域按实体 id 取一个稳定调色板色 */
  _zoneColor(st) {
    const css = getComputedStyle(this);
    if (st.entity_id === "zone.home") {
      return css.getPropertyValue("--primary-color").trim() || "#03a9f4";
    }
    const palette = ["#5c6bc0", "#26a69a", "#8d6e63", "#7e57c2", "#42a5f5"];
    let h = 5381;
    for (let i = 0; i < st.entity_id.length; i++) h = (h * 33 + st.entity_id.charCodeAt(i)) % 2147483647;
    return palette[h % palette.length];
  }
  _zoneForState(st, zones) {
    if (!st || st.state === "not_home" || st.state === "unknown" || st.state === "unavailable") return null;
    const inZone = zones.find((z) => z.attributes?.persons?.includes(st.entity_id));
    if (inZone) return inZone;
    return zones.find((z) => (z.attributes?.friendly_name || "").toLowerCase() === String(st.state).toLowerCase()) || null;
  }
  _relTime(iso) {
    const t = typeof iso === "string" ? Date.parse(iso) : Number(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.round((Date.now() - t) / 1e3));
    if (s < 60) return `${s} 秒前`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} 分钟前`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.round(h / 24)} 天前`;
  }
  /* 官方用 ha-state-icon 取实体图标；这里做轻量兜底，避免依赖内部组件 */
  _icon(st) {
    const a = st?.attributes || {};
    if (a.icon) return a.icon;
    const d = st?.entity_id?.split(".")[0];
    if (d === "person") return "mdi:account";
    if (d === "zone") return "mdi:map-marker-radius";
    if (d === "device_tracker") return "mdi:cellphone-marker";
    return "mdi:map-marker";
  }
  _initial(name) {
    const n = String(name || "?").trim();
    return n ? n.slice(0, 1).toUpperCase() : "?";
  }
  /* Tab 药丸：跟着当前可见的选中按钮走；容器还没布局时（offsetWidth=0）留到下一帧再量 */
  _syncTabPill() {
    const tabsEl = this.shadowRoot.querySelector(".cmc-tabs");
    if (!tabsEl) return;
    const pill = tabsEl.querySelector(".pill");
    if (!pill) return;
    const btns = [...tabsEl.querySelectorAll("[data-tab]")].filter((b) => !b.hidden);
    const active = btns.find((b) => b.getAttribute("aria-selected") === "true");
    if (!active || btns.length <= 1) {
      pill.style.display = "none";
      return;
    }
    pill.style.display = "";
    tabsEl.style.setProperty("--n", String(btns.length));
    const left = active.offsetLeft, width = active.offsetWidth;
    if (width) {
      pill.style.left = `${left}px`;
      pill.style.width = `${width}px`;
    }
  }
  _renderList() {
    const listEl = this.shadowRoot.querySelector("[data-list]");
    const tabsEl = this.shadowRoot.querySelector(".cmc-tabs");
    if (!listEl) return;
    const g = this._listEntries();
    const zones = g.zones;
    const counts = { people: g.people.length, devices: g.devices.length, zones: zones.length };
    let tabs = this._tab;
    if (!tabs || !counts[tabs]) {
      tabs = ["people", "devices", "zones"].find((k) => counts[k] > 0) || "people";
    }
    this._tab = tabs;
    const hasAny = counts.people + counts.devices + counts.zones > 0;
    if (tabsEl) {
      const btns = [...tabsEl.querySelectorAll("[data-tab]")];
      btns.forEach((b) => {
        const n = counts[b.dataset.tab] > 0;
        const sel = n && b.dataset.tab === tabs;
        b.hidden = !n;
        b.setAttribute("aria-selected", String(sel));
        b.disabled = !n;
        b.tabIndex = sel ? 0 : -1;
      });
      tabsEl.classList.toggle("single", btns.filter((b) => !b.hidden).length <= 1);
      this._syncTabPill();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => this._syncTabPill());
      }
    }
    listEl.setAttribute("aria-labelledby", `cmc-tab-${tabs}`);
    const rows = [];
    const mkRow = (st, name, sub, picture) => `
      <ha-list-item-button class="cmc-item" data-entity="${st.entity_id}">
        <div class="cmc-item-av" slot="start" aria-hidden="true">${picture ? `<img src="${escapeAttr(picture)}" referrerpolicy="no-referrer" alt="">` : /^[a-z]+:/.test(this._icon(st)) ? `<ha-icon icon="${escapeAttr(this._icon(st))}"></ha-icon>` : escapeHtml(this._initial(name))}</div>
        <span slot="headline">${escapeHtml(name)}</span>
        <span slot="supporting-text">${escapeHtml(sub)}</span>
      </ha-list-item-button>`;
    const items = tabs === "people" ? g.people : tabs === "devices" ? g.devices : zones;
    items.forEach((st) => {
      const name = st.attributes.friendly_name || st.entity_id;
      if (tabs === "zones") {
        const n = Number(st.state);
        rows.push(mkRow(st, name, Number.isNaN(n) ? "" : `${n} 人在此`, null));
        return;
      }
      const zone = this._zoneForState(st, zones);
      let state;
      if (zone) state = `在 ${zone.attributes.friendly_name || "区域"}`;
      else if (st.state === "not_home") state = "离家";
      else if (st.state === "home") state = "在家";
      else state = st.state;
      const sub = `${state} · ${this._relTime(st.last_updated)}`;
      rows.push(mkRow(st, name, sub, st.attributes.entity_picture));
    });
    listEl.innerHTML = rows.length ? `<ha-list-base>${rows.join("")}</ha-list-base>` : !hasAny ? `<div class="cmc-empty">地图上还没有可显示的实体</div>` : `<div class="cmc-empty">暂无${{ people: "人员", devices: "设备", zones: "区域" }[tabs]}</div>`;
    listEl.querySelectorAll("[data-entity]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.dataset.entity;
        if (!this._hass?.states?.[id]) return;
        if (this._engine?._selectedEntity === id) {
          this._openMoreInfo(id);
        } else {
          this.focusEntity(id);
        }
      });
    });
  }
  getCardSize() {
    if (this._layout === LAYOUT.FULL || this.classList.contains("cmc-bleed")) return 10;
    const r = this._parseAspect(this._config?.aspect_ratio);
    if (r) return 1 + Math.floor(100 * r.h / r.w / 25) || 3;
    return Math.ceil((this._config?.height || 360) / 50) + 1;
  }
  /* 官方卡片 API：sections 视图的栅格尺寸。
     栅格 12 列、行高 56px；不给这个方法时卡片会占满整段且高度不可调 */
  getGridOptions() {
    if (this._layout === "panel" || this.classList.contains("cmc-bleed")) {
      return { columns: "full", rows: 8, min_columns: 6, min_rows: 2, max_rows: 20 };
    }
    const px = Number(this._config?.height) || 360;
    const rows = Math.min(20, Math.max(3, Math.round(px / 56)));
    return { columns: 12, rows, min_columns: 6, min_rows: 2, max_rows: 20 };
  }
  /* 兼容 HA 2024.x 的 sections 旧接口（2024.11+ 走 getGridOptions） */
  getLayoutOptions() {
    const g = this.getGridOptions();
    return {
      grid_columns: g.columns,
      grid_rows: g.rows,
      grid_min_columns: g.min_columns,
      grid_min_rows: g.min_rows
    };
  }
  static async getConfigElement() {
    return document.createElement("ha-cn-map-card-editor");
  }
};

// src/editor.js
var BASEMAP_OPTIONS = [
  { value: "amap", label: "高德地图（默认，免 Key）" },
  { value: "amap-satellite", label: "高德卫星影像" },
  { value: "tianditu", label: "天地图（需 Key）" },
  { value: "tianditu-satellite", label: "天地图卫星（需 Key）" },
  { value: "osm", label: "OpenStreetMap（海外）" }
];
var ENTITY_FILTER = [
  { key: "person.", label: "人员 person" },
  { key: "device_tracker.", label: "设备追踪 device_tracker" },
  { key: "zone.", label: "区域 zone" },
  { key: "geo_location.", label: "地理定位 geo_location" },
  { key: "", label: "全部带坐标实体" }
];
var HaCnMapCardEditor = class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._built = false;
  }
  set hass(h) {
    this._hass = h;
    if (this._built) this._refreshEntityPicker();
  }
  setConfig(config) {
    this._config = { ...config };
    if (!this._built) this._build();
    this._syncForm();
  }
  /* ---- 结构：只建一次，之后只同步值，避免输入时丢焦点 ---- */
  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; color:var(--primary-text-color,#e8e8e8); }
        .wrap { display:flex; flex-direction:column; gap:16px; padding:6px 2px 10px; }
        .row { display:flex; flex-direction:column; gap:6px; }
        .row.inline { flex-direction:row; align-items:center; justify-content:space-between; gap:12px; }
        .row.inline label.t { flex:1; }
        label.t {
          display:block; font-size:13px; font-weight:600; line-height:1.35;
          color:var(--primary-text-color,#e8e8e8);
        }
        .hint { font-size:12px; color:var(--secondary-text-color,#a0a0a0); line-height:1.45; }
        input[type=text], input[type=number], select {
          width:100%; box-sizing:border-box; padding:9px 10px; font-size:14px;
          border-radius:8px; border:1px solid var(--divider-color,#e0e0e0);
          background:var(--card-background-color,#fff); color:var(--primary-text-color,#212121);
          font-family:inherit;
        }
        input::placeholder { color:var(--secondary-text-color,#8a8a8a); }
        input:focus, select:focus { outline:none; border-color:var(--primary-color,#03a9f4); }
        .switch { position:relative; width:44px; height:24px; flex:0 0 auto; }
        .switch input { opacity:0; width:0; height:0; }
        .slider {
          position:absolute; inset:0; border-radius:12px; cursor:pointer;
          background:var(--divider-color,#ccc); transition:background .15s;
        }
        .slider:before {
          content:""; position:absolute; width:18px; height:18px; left:3px; top:3px;
          background:#fff; border-radius:50%; transition:transform .15s;
        }
        .switch input:checked + .slider { background:var(--primary-color,#03a9f4); }
        .switch input:checked + .slider:before { transform:translateX(20px); }
        fieldset {
          border:1px solid var(--divider-color,rgba(255,255,255,.18)) !important;
          border-radius:10px; padding:14px 12px 12px; margin:0; min-inline-size:0;
        }
        legend {
          font-size:12px; padding:0 6px; color:var(--secondary-text-color,#a0a0a0);
          display:block;
        }
        .chips { display:flex; flex-wrap:wrap; gap:6px; }
        .chip {
          padding:5px 10px; border-radius:14px; font-size:12px; cursor:pointer;
          border:1px solid var(--divider-color,#e0e0e0);
          background:var(--card-background-color,#fff); color:var(--primary-text-color,#212121);
        }
        .chip.on { background:var(--primary-color,#03a9f4); border-color:var(--primary-color,#03a9f4); color:#fff; }
        .ents { display:flex; flex-direction:column; gap:6px; }
        .ent {
          display:flex; align-items:center; gap:8px; padding:7px 9px; border-radius:8px;
          background:var(--secondary-background-color,#f5f5f5);
          border:1px solid var(--divider-color,#e0e0e0);
        }
        .ent .tag { font-size:11px; padding:2px 6px; border-radius:4px; background:var(--primary-color,#03a9f4); color:#fff; flex:0 0 auto; }
        .ent .name { flex:1; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ent .del { cursor:pointer; border:none; background:none; font-size:16px; color:var(--secondary-text-color,#727272); padding:0 4px; }
        .add { display:flex; gap:6px; }
        .add select { flex:1; }
        .addbtn {
          flex:0 0 auto; padding:0 14px; border-radius:8px; border:none; cursor:pointer;
          background:var(--primary-color,#03a9f4); color:#fff; font-size:14px;
        }
        .warn {
          display:flex; gap:8px; padding:10px; border-radius:8px; font-size:12px; line-height:1.5;
          background:rgba(255,152,0,.12); color:var(--primary-text-color,#212121);
          border:1px solid rgba(255,152,0,.4);
        }
      </style>
      <div class="wrap">
        <div class="row">
          <label class="t">标题（可留空）</label>
          <input type="text" data-k="title" placeholder="家人位置">
        </div>

        <div class="row">
          <label class="t">底图来源</label>
          <select data-k="basemap">
            ${BASEMAP_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join("")}
          </select>
          <div class="hint">高德免 Key，自动做 GCJ-02 纠偏；天地图需在 console.tianditu.gov.cn 申请免费 Key。</div>
        </div>

        <div class="row">
          <label class="t">主题</label>
          <select data-k="theme_mode">
            <option value="auto">跟随 Home Assistant（默认）</option>
            <option value="light">始终浅色</option>
            <option value="dark">始终深色</option>
          </select>
          <div class="hint">高德/天地图没有暗色瓦片，深色下用 CSS 滤镜近似；卫星影像不受影响。</div>
        </div>

        <div class="row" data-only="tianditu tianditu-satellite">
          <label class="t">天地图 Key</label>
          <input type="text" data-k="tianditu_key" placeholder="粘贴你的 tk">
          <div class="hint">免费额度约 1 万次/天。Key 在前端可见，注意配额。</div>
        </div>

        <fieldset>
          <legend>显示哪些标记</legend>
          <div class="row inline">
            <label class="t">自动显示全部带坐标实体</label>
            <label class="switch"><input type="checkbox" data-k="show_all"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">显示区域（家）</label>
            <label class="switch"><input type="checkbox" data-k="show_zones"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">区域半径圈（按 zone 的 radius 画圆）</label>
            <label class="switch"><input type="checkbox" data-k="show_zone_radius"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">去重：person 已覆盖的轨迹设备</label>
            <label class="switch"><input type="checkbox" data-k="dedupe_trackers"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">跳过实体注册表里隐藏的实体</label>
            <label class="switch"><input type="checkbox" data-k="respect_hidden"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">自动适配视野包含区域半径</label>
            <label class="switch"><input type="checkbox" data-k="fit_zones"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">标记聚合（相近的合并成一个气泡）</label>
            <label class="switch"><input type="checkbox" data-k="show_cluster"><span class="slider"></span></label>
          </div>
          <div class="row">
            <label class="t">标记标签内容</label>
            <select data-k="label_mode">
              <option value="name">实体名称（默认）</option>
              <option value="state">状态</option>
              <option value="none">不显示</option>
            </select>
            <div class="hint">逐实体可用 <code>label_mode: attribute</code> + <code>attribute: battery</code> 显示任意属性。</div>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">标记下方显示状态（在家 / 离线 / 速度）</label>
            <label class="switch"><input type="checkbox" data-k="show_status"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">GPS 精度圈（需要实体带 gps_accuracy）</label>
            <label class="switch"><input type="checkbox" data-k="show_accuracy"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px">
            <label class="t">首次自动缩放到所有标记</label>
            <label class="switch"><input type="checkbox" data-k="fit_entities"><span class="slider"></span></label>
          </div>
          <div class="row inline" style="margin-top:10px" data-only="amap amap-satellite">
            <label class="t">实时路况（仅高德）</label>
            <label class="switch"><input type="checkbox" data-k="show_traffic"><span class="slider"></span></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>轨迹</legend>
          <div class="row">
            <label class="t">显示多长时间的历史轨迹</label>
            <select data-k="hours_to_show">
              <option value="0">关闭</option>
              <option value="1">1 小时</option>
              <option value="6">6 小时</option>
              <option value="12">12 小时</option>
              <option value="24">24 小时</option>
              <option value="48">48 小时</option>
              <option value="168">7 天</option>
            </select>
            <div class="hint">开启后按实体画折线，需要该实体有历史记录。</div>
          </div>
          <div class="row" data-hide-when="hours_to_show_zero">
            <label class="t">线宽</label>
            <input type="number" data-k="track_width" min="1" max="10" step="1" placeholder="3">
          </div>
        </fieldset>

        <div class="row" data-hide-when="show_all">
          <label class="t">指定实体</label>
          <div class="ents" data-ents></div>
          <div class="add">
            <select data-pickfilter>
              ${ENTITY_FILTER.map((f) => `<option value="${f.key}">${f.label}</option>`).join("")}
            </select>
            <select data-pickentity></select>
            <button class="addbtn" data-add>添加</button>
          </div>
        </div>

        <div class="row" data-hide-when="fit_entities">
          <label class="t">默认缩放级别</label>
          <input type="number" data-k="default_zoom" min="3" max="18" step="1">
        </div>

        <div class="row">
          <label class="t">显示模式</label>
          <select data-k="layout">
            <option value="auto">自动（面板视图铺满，其它固定高度）</option>
            <option value="full">总是铺满全屏</option>
            <option value="compact">总是固定高度</option>
          </select>
        </div>

        <div class="row">
          <label class="t">卡片高度（px）</label>
          <input type="number" data-k="height" min="180" max="900" step="10">
        </div>

        <div class="row">
          <label class="t">宽高比（可选，如 16:9）</label>
          <input type="text" data-k="aspect_ratio" placeholder="留空 = 用上面的高度">
          <div class="hint">填了宽高比就忽略「卡片高度」，地图按比例自适应；全屏态不生效。</div>
        </div>
      </div>
    `;
    const sr = this.shadowRoot;
    sr.querySelectorAll("[data-k]").forEach((el) => {
      const evt = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => this._onChange(el));
    });
    sr.querySelector("[data-pickfilter]").addEventListener("change", () => this._refreshEntityPicker());
    sr.querySelector("[data-add]").addEventListener("click", () => this._addEntity());
  }
  _onChange(el) {
    const key = el.dataset.k;
    let value;
    if (el.type === "checkbox") value = el.checked;
    else if (el.type === "number") value = el.value === "" ? void 0 : Number(el.value);
    else if (el.dataset.k === "hours_to_show") value = Number(el.value) || 0;
    else value = el.value;
    const cfg = { ...this._config };
    const keepZero = key === "hours_to_show";
    if (key === "layout" && value === "auto") delete cfg.layout;
    else if (value === "" || value === void 0 || value === 0 && !keepZero) delete cfg[key];
    else cfg[key] = value;
    if (key === "layout" && value === "full") delete cfg.height;
    this._config = cfg;
    this._applyVisibility();
    this._emit();
  }
  _addEntity() {
    const sel = this.shadowRoot.querySelector("[data-pickentity]");
    const id = sel.value;
    if (!id) return;
    const ents = Array.isArray(this._config.entities) ? [...this._config.entities] : [];
    if (ents.some((e) => (typeof e === "string" ? e : e.entity) === id)) return;
    ents.push({ entity: id });
    this._config = { ...this._config, entities: ents };
    this._renderEntities();
    this._emit();
  }
  _removeEntity(id) {
    let ents;
    if (String(id).startsWith("__source__")) {
      const src = String(id).slice("__source__".length);
      ents = (this._config.entities || []).filter(
        (e) => !(typeof e === "object" && !e.entity && e.source === src)
      );
    } else {
      ents = (this._config.entities || []).filter(
        (e) => (typeof e === "string" ? e : e.entity) !== id
      );
    }
    this._config = { ...this._config };
    if (ents.length) this._config.entities = ents;
    else delete this._config.entities;
    this._renderEntities();
    this._emit();
  }
  _refreshEntityPicker() {
    const sr = this.shadowRoot;
    if (!sr || !this._hass) return;
    const filter = sr.querySelector("[data-pickfilter]").value;
    const sel = sr.querySelector("[data-pickentity]");
    const states = this._hass.states || {};
    const opts = Object.keys(states).filter((id) => {
      const a = states[id]?.attributes;
      if (a?.latitude == null || a?.longitude == null) return false;
      return filter ? id.startsWith(filter) : true;
    }).sort().map((id) => {
      const n = states[id].attributes.friendly_name || id;
      return `<option value="${escapeAttr(id)}">${escapeHtml(n)} (${escapeHtml(id)})</option>`;
    });
    sel.innerHTML = opts.length ? opts.join("") : `<option value="">（没有匹配的实体）</option>`;
  }
  _renderEntities() {
    const host = this.shadowRoot.querySelector("[data-ents]");
    if (!host) return;
    const ents = this._config.entities || [];
    if (!ents.length) {
      host.innerHTML = `<div class="hint">还没有添加实体。也可以用上面的「自动显示全部」。</div>`;
      return;
    }
    host.innerHTML = ents.map((e) => {
      if (typeof e === "object" && !e.entity && e.source) {
        return `<div class="ent" data-id="${escapeAttr("__source__" + e.source)}">
            <span class="tag">source</span>
            <span class="name">geo_location 来源：${escapeHtml(e.source)}</span>
            <button class="del" title="移除">✕</button>
          </div>`;
      }
      const id = typeof e === "string" ? e : e.entity;
      if (!id) return "";
      const st = this._hass?.states?.[id];
      const name = typeof e === "object" && e.name || st?.attributes?.friendly_name || id;
      const dom = id.split(".")[0];
      return `<div class="ent" data-id="${escapeAttr(id)}">
          <span class="tag">${escapeHtml(dom)}</span>
          <span class="name">${escapeHtml(name)}</span>
          <button class="del" title="移除">✕</button>
        </div>`;
    }).join("");
    host.querySelectorAll(".del").forEach(
      (b) => b.addEventListener("click", (ev) => {
        const id = ev.target.closest(".ent").dataset.id;
        this._removeEntity(id);
      })
    );
  }
  _applyVisibility() {
    const sr = this.shadowRoot;
    const bm = this._config.basemap || "amap";
    sr.querySelectorAll("[data-only]").forEach((el) => {
      const allow = el.dataset.only.split(" ");
      el.style.display = allow.includes(bm) ? "" : "none";
    });
    sr.querySelectorAll("[data-hide-when]").forEach((el) => {
      const k = el.dataset.hideWhen;
      el.style.display = this._config[k] ? "none" : "";
    });
  }
  _syncForm() {
    const sr = this.shadowRoot;
    const c = this._config;
    sr.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (el.type === "checkbox") {
        el.checked = c[k] === void 0 ? ["fit_entities", "show_cluster", "show_status", "show_accuracy", "show_zone_radius", "dedupe_trackers", "respect_hidden"].includes(k) : !!c[k];
      } else if (el.tagName === "SELECT") {
        el.value = k === "layout" ? c[k] || "auto" : k === "theme_mode" ? c[k] || "auto" : k === "label_mode" ? c[k] || "name" : String(c[k] === void 0 ? 0 : c[k]);
      } else {
        el.value = c[k] === void 0 ? el.dataset.k === "height" ? 360 : "" : c[k];
      }
    });
    const h = sr.querySelector('[data-k="height"]');
    if (h && !h.value) h.value = 360;
    const z = sr.querySelector('[data-k="default_zoom"]');
    if (z && !z.value) z.value = 12;
    const bm = sr.querySelector('[data-k="basemap"]');
    if (bm) bm.value = c.basemap || "amap";
    this._applyVisibility();
    this._refreshEntityPicker();
    this._renderEntities();
  }
  _emit() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true
      })
    );
  }
};

// src/main.js
customElements.define("ha-cn-map-card", HaCnMapCard);
customElements.define("ha-cn-map-card-editor", HaCnMapCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-cn-map-card",
  name: "中国地图卡片",
  description: "高德/天地图底图的 HA 地图卡片，免代理直连",
  preview: true,
  documentationURL: "https://github.com/RockJesus/ha-map-cn#readme"
});
console.info("%c ha-cn-map-card v1.7.1 ", "background:#e53935;color:#fff;padding:2px 4px;border-radius:3px 0 0 3px", "background:#424242;color:#fff;padding:2px 4px;border-radius:0 3px 3px 0");
