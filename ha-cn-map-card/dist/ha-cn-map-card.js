/**
 * ha-cn-map-card v0.2.0 — 国内底图 HA 地图卡片（HACS 自定义卡片）
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
    // 比例尺由卡片渲染在 shadow DOM，引擎通过 setScaleEl 拿到引用
    this.scaleEl = null;
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
    this._updateScale(w);
  }

  /* 比例尺：取一个整齐的距离，换算成屏幕像素宽度 */
  _updateScale(w) {
    if (!this.scaleEl) return;
    const lat = this.center.lat;
    const mPerPx =
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** this.zoom;
    const targetPx = Math.min(120, w * 0.28);
    const rawM = mPerPx * targetPx;
    const pow = 10 ** Math.floor(Math.log10(rawM));
    const norm = rawM / pow;
    const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    const meters = nice * pow;
    const px = meters / mPerPx;
    this.scaleEl.style.width = `${Math.round(px)}px`;
    this.scaleEl.textContent =
      meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
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
        .cmc-scale {
          position:absolute; left:10px; bottom:10px; z-index:8;
          font-size:10px; color:var(--primary-text-color,#333);
          background:rgba(255,255,255,.75); padding:2px 6px; border-radius:4px;
          pointer-events:none; font-variant-numeric:tabular-nums;
        }
        .cmc-zoom button {
          width:32px; height:32px; border:none; border-radius:16px; font-size:17px; cursor:pointer;
          line-height:1; display:flex; align-items:center; justify-content:center;
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
          <button data-fit aria-label="显示全部" title="显示全部标记">⤢</button>
        </div>
        <div class="cmc-scale" aria-hidden="true"></div>
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
    this._engine.scaleEl = this.shadowRoot.querySelector(".cmc-scale");
    this._engine.addEventListener("marker-click", (e) => {
      const ent = this._hass?.states?.[e.detail.entityId];
      if (ent && this._hass) this._hass.callService("homeassistant", "more_info", { entity_id: e.detail.entityId });
    });
    this.shadowRoot.querySelector("[data-fit]")?.addEventListener("click", () => {
      this._didFit = false;
      this._engine._userMoved = false;
      this._update();
    });
    this.shadowRoot.querySelectorAll(".cmc-zoom button[data-z]").forEach((b) => {
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
      // 按域给默认图标，避免实体自带的地图类 icon（如 map-marker-radius）显示成放大镜
      const domain = s.entity_id.split(".")[0];
      const domainIcon =
        domain === "person" ? "mdi:account"
        : domain === "device_tracker" ? "mdi:cellphone-marker"
        : "mdi:map-marker";
      const icon = s.attributes.icon || domainIcon;
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

  static async getConfigElement() {
    return document.createElement("ha-cn-map-card-editor");
  }
}

customElements.define("ha-cn-map-card", HaCnMapCard);

/* ==================================================================
 * 可视化编辑器
 * HA 约定：独立自定义元素，实现 hass / setConfig 两个 setter，
 * 变更时 fireEvent(card, "config-changed", { config })
 * ================================================================== */
const BASEMAP_OPTIONS = [
  { value: "amap", label: "高德地图（默认，免 Key）" },
  { value: "amap-satellite", label: "高德卫星影像" },
  { value: "tianditu", label: "天地图（需 Key）" },
  { value: "tianditu-satellite", label: "天地图卫星（需 Key）" },
  { value: "osm", label: "OpenStreetMap（海外）" },
];

const ENTITY_FILTER = [
  { key: "person.", label: "人员 person" },
  { key: "device_tracker.", label: "设备追踪 device_tracker" },
  { key: "zone.", label: "区域 zone" },
  { key: "geo_location.", label: "地理定位 geo_location" },
  { key: "", label: "全部带坐标实体" },
];

class HaCnMapCardEditor extends HTMLElement {
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
            <label class="t">首次自动缩放到所有标记</label>
            <label class="switch"><input type="checkbox" data-k="fit_entities"><span class="slider"></span></label>
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
          <label class="t">卡片高度（px）</label>
          <input type="number" data-k="height" min="180" max="900" step="10">
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
    else if (el.type === "number") value = el.value === "" ? undefined : Number(el.value);
    else value = el.value;

    const cfg = { ...this._config };
    if (value === "" || value === undefined) delete cfg[key];
    else cfg[key] = value;

    // 底图切到需要 Key 的类型但没 Key 时提示，但不阻止保存
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
    const ents = (this._config.entities || []).filter(
      (e) => (typeof e === "string" ? e : e.entity) !== id
    );
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
    const opts = Object.keys(states)
      .filter((id) => {
        const a = states[id]?.attributes;
        if (a?.latitude == null || a?.longitude == null) return false;
        return filter ? id.startsWith(filter) : true;
      })
      .sort()
      .map((id) => {
        const n = states[id].attributes.friendly_name || id;
        return `<option value="${id}">${n} (${id})</option>`;
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
    host.innerHTML = ents
      .map((e) => {
        const id = typeof e === "string" ? e : e.entity;
        const st = this._hass?.states?.[id];
        const name = (typeof e === "object" && e.name) || st?.attributes?.friendly_name || id;
        const dom = id.split(".")[0];
        return `<div class="ent" data-id="${id}">
          <span class="tag">${dom}</span>
          <span class="name">${name}</span>
          <button class="del" title="移除">✕</button>
        </div>`;
      })
      .join("");
    host.querySelectorAll(".del").forEach((b) =>
      b.addEventListener("click", (ev) => {
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
        // fit_entities 默认为 true，其余默认为 false
        el.checked = c[k] === undefined ? k === "fit_entities" : !!c[k];
      } else {
        el.value = c[k] === undefined ? el.dataset.k === "height" ? 360 : "" : c[k];
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
        composed: true,
      })
    );
  }
}

customElements.define("ha-cn-map-card-editor", HaCnMapCardEditor);

// 让 HA 识别为 Lovelace 卡片（提供编辑器占位）
window.customCards = window.customCards || [];
window.customCards.push({
  type: "ha-cn-map-card",
  name: "中国地图卡片",
  description: "高德/天地图底图的 HA 地图卡片，免代理直连",
  preview: true,
});

console.info("%c ha-cn-map-card %c v0.2.0 ", "background:#e53935;color:#fff;padding:2px 4px;border-radius:3px 0 0 3px", "background:#424242;color:#fff;padding:2px 4px;border-radius:0 3px 3px 0");
