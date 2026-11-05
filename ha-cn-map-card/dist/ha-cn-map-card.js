/**
 * ha-cn-map-card — 国内底图 HA 地图卡片（HACS 自定义卡片）
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

class CnTileEngine extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.viewport = document.createElement("div");
    this.viewport.className = "cmc-viewport";
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "cmc-labels";
    this.markerLayer = document.createElement("div");
    this.markerLayer.className = "cmc-markers";
    this.attribution = document.createElement("div");
    this.attribution.className = "cmc-attribution";
    this.viewport.style.position = "absolute";
    this.viewport.style.inset = "0";
    this.labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    this.markerLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5";
    this.attribution.style.cssText =
      "position:absolute;right:4px;bottom:2px;font-size:10px;opacity:.6;pointer-events:none;color:var(--primary-text-color,#eee)";
    container.appendChild(this.viewport);
    container.appendChild(this.labelLayer);
    container.appendChild(this.markerLayer);
    container.appendChild(this.attribution);

    this.zoom = 12;
    this.center = { lat: 39.9042, lng: 116.4074 }; // 默认北京
    this.tileSets = []; // {els: Map(key->img), url(fn), zIndex, opacity, maxZoom}
    this._tileSeq = 0;
    this._attachGestures();
  }

  /* ---- Web Mercator ---- */
  static project(lat, lng) {
    const clamp = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = (clamp * Math.PI) / 180;
    const s = Math.sin(rad);
    return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
  }
  static tileXY(lat, lng, z) {
    const p = CnTileEngine.project(lat, lng);
    const n = 2 ** z;
    return { x: p.x * n, y: p.y * n };
  }

  setView(lat, lng, zoom) {
    this.center = { lat, lng };
    if (zoom != null) this.zoom = zoom;
    this.render();
  }

  addTileSet({ url, maxZoom = 18, zIndex = 1, opacity = 1, attribution = "" }) {
    const ts = { url, maxZoom, zIndex, opacity, els: new Map(), id: ++this._tileSeq };
    const layer = document.createElement("div");
    layer.className = "cmc-layer";
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

  render() {
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    const c = CnTileEngine.tileXY(this.center.lat, this.center.lng, this.zoom);
    const cx = c.x * 256;
    const cy = c.y * 256;

    this.tileSets.forEach((ts) => {
      const z = Math.min(this.zoom, ts.maxZoom);
      const scale = 2 ** (this.zoom - z);   // 缩放级差：z 级瓦片放到 zoom 级要放大几倍
      const n = 2 ** z;
      // 当前视口在 z 级瓦片坐标系里的浮点范围（c 是 zoom 级，除回去）
      const cz = 2 ** (this.zoom - z);
      const cxz = c.x / cz, cyz = c.y / cz;
      const half = (Math.max(w, h) / 256) * (1 / scale) / 2 + 2;
      const tx0 = Math.floor(cxz - half);
      const tx1 = Math.ceil(cxz + half);
      const ty0 = Math.floor(cyz - half);
      const ty1 = Math.ceil(cyz + half);
      const keep = new Set();

      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (ty < 0 || ty >= n) continue;
          const wx = ((tx % n) + n) % n;
          const key = `${z}/${wx}/${ty}`;
          keep.add(key);
          let img = ts.els.get(key);
          if (!img) {
            img = document.createElement("img");
            img.className = "cmc-tile";
            img.loading = "eager";
            img.style.cssText =
              "position:absolute;width:256px;height:256px;user-select:none;-webkit-user-drag:none;image-rendering:auto";
            img.src = ts.url(wx, ty, z);
            img.referrerPolicy = "no-referrer";
            img.onerror = () => { img.style.visibility = "hidden"; };
            ts.els.set(key, img);
            ts.layer.appendChild(img);
          }
          img.style.visibility = "visible";
          // 该瓦片左上角在 zoom 级像素坐标系中的位置，减去视口中心后居中
          const px = (tx - cxz) * 256 * scale + w / 2;
          const py = (ty - cyz) * 256 * scale + h / 2;
          img.style.left = `${px}px`;
          img.style.top = `${py}px`;
          const size = 256 * scale;
          img.style.width = `${size}px`;
          img.style.height = `${size}px`;
        }
      }
      ts.els.forEach((img, key) => {
        if (!keep.has(key)) { img.remove(); ts.els.delete(key); }
      });
    });

    this._layoutMarkers(w, h);
  }

  /* ---- 标记 ---- */
  setMarkers(markers) {
    // markers: [{lat,lng,html,label,entityId,picture}]
    this._markers = markers;
    this.markerLayer.innerHTML = "";
    this.labelLayer.innerHTML = "";
    this._markerEls = markers.map((m) => {
      const el = document.createElement("div");
      el.className = "cmc-marker";
      el.style.cssText =
        "position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:pointer;text-align:center";
      el.innerHTML = m.html || "";
      if (m.entityId) {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          this.dispatchEvent(new CustomEvent("marker-click", { detail: { entityId: m.entityId } }));
        });
      }
      this.markerLayer.appendChild(el);
      return el;
    });
    this._layoutMarkers();
  }

  _layoutMarkers(w, h) {
    if (!this._markers || !this._markerEls) return;
    w = w || this.container.clientWidth || 400;
    h = h || this.container.clientHeight || 300;
    const c = CnTileEngine.project(this.center.lat, this.center.lng);
    this._markers.forEach((m, i) => {
      const p = CnTileEngine.project(m.lat, m.lng);
      const n = 2 ** this.zoom;
      const px = (p.x - c.x) * n * 256 + w / 2;
      const py = (p.y - c.y) * n * 256 + h / 2;
      const el = this._markerEls[i];
      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      el.style.display = px < -60 || px > w + 60 || py < -80 || py > h + 60 ? "none" : "";
    });
  }

  /* ---- 交互 ---- */
  _attachGestures() {
    let dragging = false, lastX = 0, lastY = 0, pinchDist = 0;
    const el = this.container;
    el.style.touchAction = "none";

    const panBy = (dx, dy) => {
      this._userMoved = true;
      const c = CnTileEngine.tileXY(this.center.lat, this.center.lng, this.zoom);
      const n = 2 ** this.zoom;
      const lng = ((c.x * 256 - dx) / 256 / n) * 360 - 180;
      const my = (c.y * 256 - dy) / 256 / n;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
      this.setView(lat, lng);
    };

    el.addEventListener("pointerdown", (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      panBy(lastX - e.clientX, lastY - e.clientY);
      lastX = e.clientX; lastY = e.clientY;
    });
    el.addEventListener("pointerup", () => (dragging = false));
    el.addEventListener("pointercancel", () => (dragging = false));
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    el.addEventListener("dblclick", () => this.setZoom(this.zoom + 1));
    el.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (pinchDist) this.setZoom(this.zoom + (d > pinchDist ? 1 : -1));
        pinchDist = d;
      }
    }, { passive: true });
    el.addEventListener("touchend", () => (pinchDist = 0));
  }

  setZoom(z) {
    this._userMoved = true;
    this.zoom = Math.max(3, Math.min(18, z));
    this.render();
  }

  fitBounds(points, padding = 40) {
    if (!points.length) return;
    if (points.length === 1) { this.setView(points[0].lat, points[0].lng, 14); return; }
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    points.forEach((p) => {
      const t = CnTileEngine.project(p.lat, p.lng);
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    });
    const w = this.container.clientWidth || 400;
    const h = this.container.clientHeight || 300;
    let best = 3;
    for (let z = 18; z >= 3; z--) {
      const n = 2 ** z;
      if ((maxX - minX) * n * 256 < w - 2 * padding && (maxY - minY) * n * 256 < h - 2 * padding) { best = z; break; }
    }
    this.setView(latFromY((minY + maxY) / 2), lngFromX((minX + maxX) / 2), best);

    function latFromY(y) { return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI; }
    function lngFromX(x) { return x * 360 - 180; }
  }
}

/* ---- GCJ-02 → WGS84（高德底图时把 WGS84 标记投到底图坐标系） ---- */
const GCJ = (() => {
  const a = 6378245.0, ee = 0.00669342162296594323;
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
    layers: [
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=img_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
      { template: (x, y, z, tk) => `https://t${x % 8}.tianditu.gov.cn/DataServer?T=cia_w&x=${x}&y=${y}&l=${z}&tk=${tk}` },
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

/* ---- 卡片 ---- */
class HaCnMapCard extends HTMLElement {
  static getStubConfig() {
    return { show_all: true };
  }
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("ha-cn-map-card: 配置无效");
    this._config = {
      basemap: "amap",            // amap | amap-satellite | tianditu | tianditu-satellite | osm
      tianditu_key: "",
      default_zoom: 12,
      hours_to_show: 0,
      show_all: false,
      show_zones: false,
      fit_entities: true,
      entities: [],
      geo_location_sources: [],
      title: "",
      ...config,
    };
    if (BASEMAPS[this._config.basemap]?.requireKey && !this._config.tianditu_key) {
      console.warn("[ha-cn-map-card] 天地图需要 tianditu_key，已回退到高德");
      this._config.basemap = "amap";
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._engine) this._update();
  }

  _render() {
    const cfg = this._config;
    const base = BASEMAPS[cfg.basemap] || BASEMAPS.amap;
    const titleHtml = cfg.title
      ? `<div class="cmc-title">${cfg.title}</div>` : "";
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; height:${cfg.height || 360}px; }
        .cmc-card {
          width:100%;
          position:relative; overflow:hidden; border-radius:var(--ha-card-border-radius,12px);
          background:var(--card-background-color,#fff);
          border:1px solid var(--ha-card-border-color,rgba(0,0,0,.12));
          height:100%; box-sizing:border-box;
        }
        .cmc-map { position:absolute; inset:${cfg.title ? "34px" : "0"} 0 0 0; overflow:hidden; cursor:grab; }
        .cmc-map:active { cursor:grabbing; }
        .cmc-title {
          position:absolute; top:0; left:0; right:0; height:34px; z-index:10;
          display:flex; align-items:center; padding:0 12px; font-weight:600;
          font-size:15px; background:var(--card-background-color,#fff);
          color:var(--primary-text-color,#111); border-bottom:1px solid rgba(0,0,0,.06);
        }
        .cmc-zoom { position:absolute; top:${cfg.title ? 44 : 10}px; left:10px; z-index:10; display:flex; flex-direction:column; gap:6px; }
        .cmc-zoom button {
          width:32px; height:32px; border:none; border-radius:16px; font-size:18px; cursor:pointer;
          background:var(--card-background-color,#fff); color:var(--primary-text-color,#111);
          box-shadow:0 1px 4px rgba(0,0,0,.25);
        }
        .cmc-marker img { width:34px; height:34px; border-radius:50%; border:3px solid #fff; box-shadow:0 1px 5px rgba(0,0,0,.5); object-fit:cover; }
        .cmc-marker .cmc-fallback {
          width:30px; height:30px; margin:0 auto; border-radius:50%; border:3px solid #fff;
          --mdc-icon-size:18px;
          box-shadow:0 1px 5px rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center;
          font-size:16px; background:#58a6f0; color:#fff;
        }
        .cmc-marker .cmc-label {
          margin-top:2px; font-size:11px; color:#fff; text-shadow:0 0 3px rgba(0,0,0,.9), 0 0 2px rgba(0,0,0,.9);
          white-space:nowrap;
        }
        .cmc-home { font-size:26px; --mdc-icon-size:26px; color:#ff7043; filter:drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
        .cmc-attribution { color:var(--primary-text-color,#eee); }
      </style>
      <div class="cmc-card">
        ${titleHtml}
        <div class="cmc-map"></div>
        <div class="cmc-zoom">
          <button data-z="1" aria-label="放大">+</button>
          <button data-z="-1" aria-label="缩小">−</button>
        </div>
      </div>
    `;

    const mapEl = this.shadowRoot.querySelector(".cmc-map");
    this._engine = new CnTileEngine(mapEl);
    this._engine.removeTileSets();
    base.layers.forEach((l, i) => {
      this._engine.addTileSet({
        url: (x, y, z) => l.template(x, y, z, cfg.tianditu_key),
        maxZoom: base.maxZoom,
        opacity: l.opacity ?? 1,
        zIndex: i + 1,
      });
    });
    this._engine.attribution.textContent = base.attribution;
    this._engine.addEventListener("marker-click", (e) => {
      const ent = this._hass?.states?.[e.detail.entityId];
      if (ent && this._hass) this._hass.callService("homeassistant", "more_info", { entity_id: e.detail.entityId });
    });
    this.shadowRoot.querySelectorAll(".cmc-zoom button").forEach((b) => {
      b.addEventListener("click", () => this._engine.setZoom(this._engine.zoom + Number(b.dataset.z)));
    });

    this._basemapShift = base.needsShift;
    if (this._hass) this._update(); else this._engine.render();
  }

  _collectEntities() {
    const hass = this._hass;
    if (!hass) return [];
    const cfg = this._config;
    let ids = [];
    if (cfg.entities?.length) ids = [...cfg.entities];
    if (cfg.show_all) {
      ids = Object.keys(hass.states).filter((id) => {
        const d = hass.states[id];
        return d?.attributes?.latitude != null && (id.startsWith("person.") || id.startsWith("device_tracker.") || id.startsWith("geo_location."));
      });
    }
    if (cfg.geo_location_sources?.length) {
      ids.push(...Object.keys(hass.states).filter((id) => {
        const d = hass.states[id];
        return id.startsWith("geo_location.") && cfg.geo_location_sources.includes(d.attributes?.source);
      }));
    }
    return [...new Set(ids)].map((id) => hass.states[id]).filter(Boolean);
  }

  _update() {
    const hass = this._hass, cfg = this._config;
    const states = this._collectEntities();
    const markers = [];
    const pts = [];

    states.forEach((s) => {
      const { latitude, longitude, friendly_name } = s.attributes;
      if (latitude == null) return;
      let lat = latitude, lng = longitude;
      if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
      const pic = s.attributes.entity_picture;
      const icon = s.attributes.icon || (s.entity_id.startsWith("person.") ? "mdi:account" : "mdi:map-marker");
      markers.push({
        lat, lng, entityId: s.entity_id,
        html: `${pic ? `<img src="${pic}" referrerpolicy="no-referrer">`
          : `<div class="cmc-fallback"><ha-icon icon="${icon}"></ha-icon></div>`}
               <div class="cmc-label">${friendly_name || s.entity_id}</div>`,
      });
      pts.push({ lat: latitude, lng: longitude }); // fitBounds 用原始坐标
    });

    if (cfg.show_zones) {
      Object.values(hass.states).filter((s) => s.entity_id.startsWith("zone.")).forEach((z) => {
        const { latitude, longitude, friendly_name, passive } = z.attributes;
        if (latitude == null || passive) return;
        let lat = latitude, lng = longitude;
        if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
        markers.push({
          lat, lng,
          html: `<div class="cmc-home"><ha-icon icon="${z.attributes.icon || "mdi:home"}"></ha-icon></div>`,
        });
        pts.push({ lat: latitude, lng: longitude });
      });
    }

    this._engine.setMarkers(markers);
    // 只在首次、且用户还没手动拖动/缩放时自动适配视野
    if (cfg.fit_entities && pts.length && !this._didFit && !this._engine._userMoved) {
      this._engine.fitBounds(pts);
      this._didFit = true;
    } else if (!this._didFit) {
      this._engine.render();
    }
  }

  getCardSize() { return Math.ceil((this._config?.height || 360) / 50) + 1; }

  static getConfigElement() {
    const el = document.createElement("ha-form");
    // 简化：用原生编辑器不支持时的 JSON 编辑兜底
    const ta = document.createElement("ha-yaml-editor");
    ta.defaultValue = { type: "custom:ha-cn-map-card", show_all: true };
    return ta;
  }
}

customElements.define("ha-cn-map-card", HaCnMapCard);

// 让 HA 识别为 Lovelace 卡片（提供编辑器占位）
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-cn-map-card",
  name: "中国地图卡片",
  description: "高德/天地图底图的 HA 地图卡片，免代理直连",
  preview: true,
});

console.info("%c ha-cn-map-card %c v0.1.0 ", "background:#e53935;color:#fff;padding:2px 4px;border-radius:3px 0 0 3px", "background:#424242;color:#fff;padding:2px 4px;border-radius:0 3px 3px 0");
