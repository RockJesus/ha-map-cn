// map-cn-card：HA 地图卡片中国版（高德/腾讯/天地图/OSM 底图）
// 功能对齐官方 hui-map-card：entities / show_all / geo_location_sources /
// auto_fit / fit_zones / show_zone_radius / default_zoom / hours_to_show(轨迹) /
// dark_mode / theme_mode / cluster / conditions / scale_ruler / aspect_ratio / title
import { LitElement, html, css, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  TILE_PROVIDERS,
  DEFAULT_PROVIDER,
  DEFAULT_STYLE,
} from "./tiles";
import { toMapCoords } from "./coord";
import {
  entityMapColor,
  zoneColor,
  defaultIconForDomain,
} from "./colors";
import { subscribeHistory, extractPathPoints } from "./history";
import {
  checkConditionsMet,
  addEntityToCondition,
} from "./conditions";
// 编辑器静态引入：单文件产物方案下动态 import() 不会被 esbuild 内联（运行时 404）
import "./map-cn-card-editor.js";
// 可视化设置抽屉（面板工具栏 ⚙️，借鉴 ha-china-map settings 交互）
import "./map-cn-settings.js";
// Overview 抽屉组件（对齐官方 hui-map-overview）+ 仪表盘 strategy 注册（UI 创建中国地图仪表盘）
import "./map-cn-overview.js";
import { registerMapCnDashboardStrategy } from "./map-cn-strategy.js";

const DEFAULT_ZOOM = 14;
// 中国中心 WGS-84 [104,35] 转 GCJ-02（底图坐标系）后值；全国视野偏差虽小但保持精确
const DEFAULT_CENTER = [104.00251, 34.99908];
const DEFAULT_CENTER_ZOOM = 4;
const MARKER_SIZE = 48;
const ZONE_CIRCLE_SIZE = 36;
const CLUSTER_RADIUS_PX = 60;
const NOMINAL_ACCURACY = 2.5;
const EARTH_CIRCUMFERENCE = 40075016.686;

// 面板工具栏/设置抽屉可运行时覆盖的配置键（localStorage 持久化，浏览器本地生效）
const RUNTIME_LS_KEY = "map-cn-runtime-options";
const RUNTIME_KEYS = [
  "provider",
  "style",
  "theme_mode",
  "dark_mode",
  "default_zoom",
  "max_zoom",
  "hours_to_show",
  "home_label",
  "track_color",
  "show_traffic",
  "show_zones",
  "show_labels",
  "tianditu_key",
  "amap_key",
  "coordinate_system",
];
function loadRuntimeOptions() {
  try {
    return JSON.parse(window.localStorage.getItem(RUNTIME_LS_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveRuntimeOptions(opts) {
  try {
    window.localStorage.setItem(RUNTIME_LS_KEY, JSON.stringify(opts));
  } catch {
    /* 隐私模式等写入失败忽略 */
  }
}

// 官方 MAP_STYLES 预设 → 本卡片 raster 瓦片的近似渲染滤镜（编辑器中选项与官方一致）
const MAP_STYLE_FILTERS = {
  default: "",
  colorful: "saturate(1.12)",
  natural: "saturate(0.95) sepia(0.06)",
  muted: "saturate(0.7)",
  gray: "grayscale(1)",
  toner: "grayscale(1) contrast(1.15)",
};
const DEFAULT_MAP_STYLE = "default";

// 官方 SELECTABLE_DOMAINS（person/device_tracker/zone）
const SELECTABLE_DOMAINS = ["person", "device_tracker", "zone"];
const SELECTED_ENTITY_PARAM = "entity_id";
const OVERVIEW_GAP = 12;

const computeDomain = (entityId) => entityId.split(".")[0];

// 与官方 map-engine 一致：球面大圆 bounding box 角点（fitBounds 用）
const EARTH_RADIUS = 6371008.8;
const toRadians = (deg) => (deg * Math.PI) / 180;
const toDegrees = (rad) => (rad * 180) / Math.PI;
const circleBoundsPoints = (center, radiusMeters) => {
  const angular = radiusMeters / EARTH_RADIUS;
  const latMin = Math.max(-90, center[0] - toDegrees(angular));
  const latMax = Math.min(90, center[0] + toDegrees(angular));
  const sinRatio = Math.sin(angular) / Math.cos(toRadians(center[0]));
  if (latMin <= -90 || latMax >= 90 || Math.abs(sinRatio) >= 1) {
    return [
      [latMin, -180],
      [latMax, 180],
    ];
  }
  const dLng = toDegrees(Math.asin(sinRatio));
  return [
    [latMin, center[1] - dLng],
    [latMax, center[1] + dLng],
  ];
};

// 与官方 map-engine.pixelDistance 一致：墨卡托投影像素距离（_focusZoom 用）
const MERCATOR_MAX_LAT = 85.051129;
const projectMercator = ([lat, lng], scale) => {
  const sinLat = Math.sin(
    toRadians(Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat)))
  );
  return {
    x: (lng / 360 + 0.5) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
};
const pixelDistance = (a, b, zoom) => {
  const scale = 256 * 2 ** zoom;
  const pa = projectMercator(a, scale);
  const pb = projectMercator(b, scale);
  const dx = Math.abs(pa.x - pb.x);
  return Math.hypot(Math.min(dx, scale - dx), pa.y - pb.y);
};

// 与官方 computeRTL 一致的简化版（影响 overview padding 侧与按钮位置）
const computeRTL = (hass) => {
  const lang = hass?.language || "en";
  return ["he", "ar", "fa", "ur", "yi"].includes(lang);
};

// 与官方 getEntityLocation 一致：person 无坐标时回退到第一个非被动 in_zone 坐标
const findFirstActiveZone = (inZones, states) => {
  for (const zoneId of inZones || []) {
    const zone = states?.[zoneId];
    if (
      zone &&
      !zone.attributes.passive &&
      typeof zone.attributes.latitude === "number" &&
      typeof zone.attributes.longitude === "number"
    ) {
      return zone;
    }
  }
  return undefined;
};
const getEntityLocation = (stateObj, states) => {
  if (!stateObj) {
    return undefined;
  }
  const { latitude, longitude, gps_accuracy: gpsAccuracy } = stateObj.attributes;
  if (typeof latitude === "number" && typeof longitude === "number") {
    return { latitude, longitude, gpsAccuracy };
  }
  if (computeDomain(stateObj.entity_id) !== "person") {
    return undefined;
  }
  const zone = findFirstActiveZone(stateObj.attributes.in_zones, states);
  if (!zone) {
    return undefined;
  }
  return {
    latitude: zone.attributes.latitude,
    longitude: zone.attributes.longitude,
  };
};

// 与官方一致的文字对比色（WCAG 3:1）
const contrastingContent = (color) => {
  try {
    const hex = color.trim().replace(/^#/, "");
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    const r = parseInt(full.substr(0, 2), 16) / 255;
    const g = parseInt(full.substr(2, 2), 16) / 255;
    const b = parseInt(full.substr(4, 2), 16) / 255;
    const lum = (c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
    const contrastWhite = (1.05) / (L + 0.05);
    return contrastWhite >= 3 ? "#ffffff" : "#000000";
  } catch {
    return "#ffffff";
  }
};

const zoneInitials = (name) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

class MapCnCard extends LitElement {
  static properties = {
    hass: { attribute: false },
    layout: { attribute: false },
    _error: { state: true },
  };

  constructor() {
    super();
    this._entityMarkers = {};
    this._zoneMarkers = {};
    this._clusterMarkers = {};
    this._pathLayers = {};
    this._fitPoints = [];
    this._clusterSeq = 0;
    this._entityCount = 0;
    this._autoFitted = false;
    this._mapLoaded = false;
    this._subscribed = false;
    this._historyUnsub = undefined;
    this._overviewTab = "people";
    this._overviewSelected = undefined;
    this._overviewSize = { width: 0, height: 0 };
    this._path = undefined;
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Error in card configuration.");
    }
    if (
      !config.show_all &&
      !config.entities?.length &&
      !config.geo_location_sources
    ) {
      throw new Error(
        "Either show_all, entities, or geo_location_sources must be specified"
      );
    }
    if (config.entities && !Array.isArray(config.entities)) {
      throw new Error("Entities need to be an array");
    }
    if (
      config.geo_location_sources &&
      !Array.isArray(config.geo_location_sources)
    ) {
      throw new Error("Parameter geo_location_sources needs to be an array");
    }
    if (config.show_all && (config.entities || config.geo_location_sources)) {
      throw new Error(
        "Cannot specify show_all and entities or geo_location_sources"
      );
    }
    this._config = { ...config };
    // 面板工具栏/设置抽屉保存的运行时选项（localStorage）覆盖卡片配置；
    // 编辑器（preview）场景不合并，保证编辑看到的是配置原值。
    if (!this.preview && typeof window !== "undefined") {
      const rt = loadRuntimeOptions();
      for (const k of RUNTIME_KEYS) {
        if (rt[k] !== undefined && rt[k] !== null) {
          this._config[k] = rt[k];
        }
      }
    }
    if (this.hass && config.show_all) {
      this._config.entities = this._getAllEntities();
    }
    this._configEntities = this._config.entities
      ? this._config.entities.map((entity) =>
          typeof entity === "string" ? { entity } : { ...entity }
        )
      : [];
    this._clusterEnabled = this._config.cluster ?? true;
  }

  getCardSize() {
    if (!this._config?.aspect_ratio) {
      return 7;
    }
    const m = String(this._config.aspect_ratio).match(/^(\d+)\s*\/\s*(\d+)$/);
    const ar = m && Number(m[2]) > 0 ? (100 * Number(m[2])) / Number(m[1]) : 100;
    return 1 + Math.floor(ar / 25) || 3;
  }

  // 与官方一致：网格布局下跨全列、占 4 行
  getGridOptions() {
    return {
      columns: "full",
      rows: 4,
      min_columns: 6,
      min_rows: 2,
    };
  }

  static getConfigElement() {
    // 编辑器已随主模块静态打包（见顶部 import）
    return document.createElement("map-cn-editor");
  }

  static getStubConfig(hass, entities) {
    const found = (entities || []).filter((e) =>
      e.startsWith("device_tracker.")
    );
    return {
      provider: DEFAULT_PROVIDER,
      entities: found.slice(0, 2).map((e) => ({ entity: e })),
      theme_mode: "auto",
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this._subscribed = false;
    // 与官方一致：URL entity_id 参数选择实体
    this._path = window.location.pathname;
    window.addEventListener("popstate", this._syncSelection);
    window.addEventListener("location-changed", this._syncSelection);
    this._syncSelection();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this._syncSelection);
    window.removeEventListener("location-changed", this._syncSelection);
    this._unsubscribeHistory();
  }

  firstUpdated() {
    this._updateAspectRatio();
    this._initMap();
    this._updateAll();
  }

  // 与官方 shouldUpdate 一致：过滤与地图无关的 hass 状态变化（避免每次
  // 温度传感器更新都重建全部 marker）。保守策略：layout/preview/config 变化
  // 必更新；show_all/geo_location 模式任何 hass 变化都更新（需跟踪所有实体）；
  // 配置实体模式仅相关实体状态变化才更新。
  shouldUpdate(changedProps) {
    if (changedProps.has("layout") || changedProps.has("preview") || changedProps.has("config")) {
      return true;
    }
    if (!changedProps.has("hass") || changedProps.size > 1) {
      return true;
    }
    const oldHass = changedProps.get("hass");
    if (!oldHass || !this.hass || !this._configEntities) {
      return true;
    }
    if (oldHass.themes?.darkMode !== this.hass.themes?.darkMode) {
      return true;
    }
    if (this._config?.show_all || this._config?.geo_location_sources) {
      return true;
    }
    // 轨迹订阅失败/未建立时允许重试（对照官方：组件列表变化时重试订阅）
    if (this._config?.hours_to_show && !this._subscribed && !this._error) {
      return true;
    }
    const ids = this._mapEntities().map((e) => e.entity_id);
    const oldStates = oldHass.states;
    const newStates = this.hass.states;
    for (const id of ids) {
      if (oldStates[id] !== newStates[id]) {
        return true;
      }
    }
    return false;
  }

  willUpdate(changedProps) {
    if (changedProps.has("layout")) {
      this._syncSelection();
    }
    if (changedProps.has("hass") && this._map) {
      if (this._config?.show_all) {
        this._config.entities = this._getAllEntities();
        this._configEntities = this._config.entities.map((entity) =>
          typeof entity === "string" ? { entity } : { ...entity }
        );
      }
      this._updateAll();
    }
    if (changedProps.has("layout") || changedProps.has("hass")) {
      this._updateAspectRatio();
    }
  }

  render() {
    if (this._error) {
      // 与官方一致：错误时仍保留 ha-card 全屏容器（height:100%），容器内显示错误提示，
      // 避免地图加载失败（WebGL/瓦片/底图 key）时卡片塌陷成一条 64px 的错误条
      return html`<ha-card class="map-cn-error">
        <ha-alert alert-type="error" class="map-cn-error-alert">
          ${this.hass?.localize?.("ui.components.map.error") || "Map error"}:
          ${this._error.message} (${this._error.code})
        </ha-alert>
      </ha-card>`;
    }
    const isDark =
      this._config?.dark_mode || this._config?.theme_mode === "dark"
        ? true
        : this._config?.theme_mode === "light"
          ? false
          : this.hass?.themes?.darkMode ?? false;
    const panel = this.layout === "panel" || this.layout === "grid";
    const rtl = computeRTL(this.hass);
    const showToolbar = panel && !this.preview;
    const activeProvider = this._config?.provider || DEFAULT_PROVIDER;
    const trackColor = this._config?.track_color || "#e91e63";
    const homeLabel = this._config?.home_label || "家";
    return html`
      <ha-card id="card" .header=${this._config?.title}>
        <div
          id="root"
          class="${panel ? "panel-layout" : ""}${rtl ? " rtl" : ""}"
          style=${styleMap({
            "--map-cn-dark": isDark ? "1" : "0",
            "--overview-width": `${this._overviewSize.width}px`,
            "--overview-height": `${this._overviewSize.height}px`,
          })}
        >
          <div id="map" class="map-cn-map"></div>
          <div id="buttons" class=${rtl ? "rtl" : ""}>
            ${
              this._config && this._entityCount > 1
                ? html`<ha-icon-button
                    .label=${this._clusterEnabled
                      ? "取消聚合"
                      : "聚合标记"}
                    @click=${this._toggleCluster}
                    ><ha-icon
                      icon=${
                        this._clusterEnabled
                          ? "mdi:google-circles-communities"
                          : "mdi:dots-hexagon"
                      }
                    ></ha-icon
                  ></ha-icon-button>`
                : nothing
            }
            <ha-icon-button .label=${"重置视野"} @click=${this._resetFocus}
              ><ha-icon icon="mdi:image-filter-center-focus"></ha-icon
            ></ha-icon-button>
          </div>
          ${
            showToolbar
              ? html`<div class="map-cn-toolbar" @click=${this._handleToolbarClick}>
                  <button
                    class="map-cn-tool ${activeProvider === "gaode" ? "active" : ""}"
                    data-provider="gaode"
                    title="高德地图（自动纠偏）"
                  >
                    <ha-icon icon="mdi:map"></ha-icon><span>高德</span>
                  </button>
                  <button
                    class="map-cn-tool ${activeProvider === "tencent" ? "active" : ""}"
                    data-provider="tencent"
                    title="腾讯地图（自动纠偏）"
                  >
                    <ha-icon icon="mdi:map-marker-radius"></ha-icon><span>腾讯</span>
                  </button>
                  <button
                    class="map-cn-tool ${activeProvider === "tianditu" ? "active" : ""}"
                    data-provider="tianditu"
                    title="天地图（不偏移，需 Key）"
                  >
                    <ha-icon icon="mdi:map-outline"></ha-icon><span>天地图</span>
                  </button>
                  <span class="map-cn-sep"></span>
                  <button
                    class="map-cn-tool ${this._styleName === "satellite" ? "active" : ""}"
                    data-action="satellite"
                    title="卫星影像"
                  >
                    <ha-icon icon="mdi:satellite-variant"></ha-icon>
                  </button>
                  <button
                    class="map-cn-tool ${this._config?.show_traffic ? "active" : ""}"
                    data-action="traffic"
                    title="实时路况（高德）"
                  >
                    <ha-icon icon="mdi:traffic-light"></ha-icon>
                  </button>
                  <button
                    class="map-cn-tool ${isDark ? "active" : ""}"
                    data-action="dark"
                    title="暗色模式"
                  >
                    <ha-icon icon="mdi:theme-light-dark"></ha-icon>
                  </button>
                  <span class="map-cn-sep"></span>
                  <button class="map-cn-tool" data-action="fit" title="显示全部">
                    <ha-icon icon="mdi:fit-to-screen"></ha-icon>
                  </button>
                  <button class="map-cn-tool" data-action="settings" title="地图设置">
                    <ha-icon icon="mdi:cog"></ha-icon>
                  </button>
                </div>
                <div class="map-cn-legend">
                  <span
                    ><i
                      style="background:${this._config?.show_zones === false
                        ? "transparent"
                        : "#03a9f4"}"
                    ></i
                    >${homeLabel}</span
                  >
                  <span><i style="background:#ff9800"></i>区域</span>
                  <span><i style="background:${trackColor}"></i>轨迹</span>
                </div>
                <map-cn-settings
                  id="settings"
                  @map-cn-settings-save=${this._onSettingsSave}
                ></map-cn-settings>`
              : nothing
          }
          ${
            panel && !this.preview
              ? html`<map-cn-overview
                  id="overview"
                  .hass=${this.hass}
                  .entities=${this._overviewEntities()}
                  .selected=${this._overviewSelected}
                  .tab=${this._overviewTab}
                  @map-overview-select=${this._handleOverviewSelect}
                  @map-overview-tab=${this._handleOverviewTab}
                  @map-overview-resize=${this._handleOverviewResize}
                ></map-cn-overview>`
              : nothing
          }
        </div>
      </ha-card>
    `;
  }

  // 与官方一致：无 aspect_ratio 时 1:1（padding-bottom 100%），panel/grid 忽略比例
  _updateAspectRatio() {
    const root = this.shadowRoot?.getElementById("root");
    if (!root) {
      return;
    }
    const ignore = this.layout === "panel" || this.layout === "grid";
    root.style.removeProperty("padding-bottom");
    if (ignore || !this._config) {
      return;
    }
    let padding = "100%";
    if (this._config.aspect_ratio) {
      const ratio = String(this._config.aspect_ratio).match(
        /^(\d+)\s*\/\s*(\d+)$/
      );
      if (ratio && Number(ratio[1]) > 0 && Number(ratio[2]) > 0) {
        padding = `${((100 * Number(ratio[2])) / Number(ratio[1])).toFixed(2)}%`;
      }
    }
    root.style.paddingBottom = padding;
  }

  _computeRtl() {
    try {
      return (
        this.hass?.locale?.language === "ar" ||
        this.hass?.locale?.language === "he" ||
        this.hass?.locale?.language === "fa" ||
        this.hass?.locale?.language === "ur"
      );
    } catch {
      return false;
    }
  }

  _initMap() {
    if (this._map || this._mapInitializing) {
      return;
    }
    this._mapInitializing = true;
    const container = this.shadowRoot.getElementById("map");
    if (!container) {
      return;
    }
    const config = this._config || {};
    const provider =
      TILE_PROVIDERS[config.provider] || TILE_PROVIDERS[DEFAULT_PROVIDER];
    this._provider = provider;
    const styleName =
      provider.styles[config.style] && config.style
        ? config.style
        : DEFAULT_STYLE;
    this._styleName = styleName;
    this._coordinateSystem =
      config.coordinate_system && config.coordinate_system !== "auto"
        ? config.coordinate_system
        : provider.coordinateSystem;

    if (provider.requiresKey && !config.tianditu_key) {
      this._error = {
        code: "tianditu_key",
        message: "天地图需要 tianditu_key（天地图官网免费申请）",
      };
      this._mapInitializing = false;
      return;
    }

    const styleConf = provider.styles[styleName];
    const urls =
      typeof styleConf.urls === "function"
        ? styleConf.urls(config.tianditu_key)
        : styleConf.urls;

    const style = {
      version: 8,
      sources: {
        tiles: {
          type: "raster",
          tiles: urls,
          tileSize: 256,
          maxzoom: styleConf.maxzoom || 18,
          attribution: provider.attribution,
        },
      },
      layers: [
        { id: "tiles", type: "raster", source: "tiles" },
      ],
    };

    // 天地图注记叠加层
    if (styleConf.labelUrls) {
      const labelUrls =
        typeof styleConf.labelUrls === "function"
          ? styleConf.labelUrls(config.tianditu_key)
          : styleConf.labelUrls;
      style.sources.labels = {
        type: "raster",
        tiles: labelUrls,
        tileSize: 256,
        maxzoom: styleConf.maxzoom || 18,
        attribution: provider.attribution,
      };
      style.layers.push({
        id: "labels",
        type: "raster",
        source: "labels",
      });
    }

    try {
      this._map = new maplibregl.Map({
        container,
        style,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_CENTER_ZOOM,
        attributionControl: { compact: true },
        renderWorldCopies: true,
        // 腾讯地图瓦片 y 轴为 TMS（从南到北），MapLibre 请求的是 XYZ（从北到南）：
        // 需 y' = 2^z - 1 - y 反转后才能取到正确瓦片（实测 XYZ y=6105 北京返回纯白占位图，
        // TMS y=10278 才是真实北京地图）。其余供应商（高德/天地图/OSM）为标准 XYZ，不改写。
        transformRequest: (url, resourceType) => {
          if (
            resourceType === "Tile" &&
            url.includes(".map.gtimg.com/tile")
          ) {
            const m = url.match(/[?&]z=(\d+)[^&]*&x=(\d+)[^&]*&y=(\d+)/);
            if (m) {
              const z = Number(m[1]);
              const yTms = (1 << z) - 1 - Number(m[3]);
              return { url: url.replace(`y=${m[3]}`, `y=${yTms}`) };
            }
          }
          return { url };
        },
      });
    } catch (err) {
      this._error = { code: "map_init", message: String(err) };
      this._mapInitializing = false;
      return;
    }

    this._map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "topleft"
    );
    if (this._config?.scale_ruler) {
      this._map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));
    }

    this._map.on("click", () => {
      // 与官方 _handleMapClicked 一致：点击地图空白处取消选择
      if (this._overviewSelected) {
        this._deselect();
      }
    });

    this._map.on("load", () => {
      this._mapLoaded = true;
      this._applyDarkFilter();
      this._updateAll();
    });

    let resizeTimer;
    this._map.on("moveend", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this._resizeCircles();
        this._applyClustering();
      }, 60);
    });
    this._map.on("zoomend", () => {
      this._resizeCircles();
      this._applyClustering();
    });
    this._mapInitializing = false;
  }

  // ---------- 面板工具栏 / 设置抽屉（借鉴 ha-china-map 交互，localStorage 持久化） ----------

  _handleToolbarClick(ev) {
    const btn = ev.target.closest(".map-cn-tool");
    if (!btn) {
      return;
    }
    if (btn.dataset.provider) {
      this._setProvider(btn.dataset.provider);
      return;
    }
    const action = btn.dataset.action;
    if (action === "satellite") {
      this._toggleSatellite();
    } else if (action === "traffic") {
      this._toggleTraffic();
    } else if (action === "dark") {
      this._cycleTheme();
    } else if (action === "fit") {
      this._fitAll();
    } else if (action === "settings") {
      this._openSettings();
    }
  }

  _setProvider(provider) {
    if (!TILE_PROVIDERS[provider]) {
      return;
    }
    this._config.provider = provider;
    this._saveRuntimeOptions();
    this._rebuildTileLayers();
    this.requestUpdate();
  }

  _toggleSatellite() {
    this._config.style =
      this._styleName === "satellite" ? "normal" : "satellite";
    this._saveRuntimeOptions();
    this._rebuildTileLayers();
    this.requestUpdate();
  }

  _toggleTraffic() {
    this._config.show_traffic = !this._config.show_traffic;
    this._saveRuntimeOptions();
    this._rebuildTileLayers();
    this.requestUpdate();
  }

  _cycleTheme() {
    const cur = this._config?.theme_mode;
    this._config.theme_mode =
      cur === "dark" ? "light" : cur === "light" ? "auto" : "dark";
    this._saveRuntimeOptions();
    this._applyDarkFilter();
    this.requestUpdate();
  }

  _openSettings() {
    const el = this.shadowRoot?.getElementById("settings");
    if (el && typeof el.open === "function") {
      el.open(this._config || {}, this.hass);
    }
  }

  _onSettingsSave(ev) {
    const opts = ev.detail || {};
    this._config = { ...this._config, ...opts };
    this._saveRuntimeOptions();
    this._rebuildTileLayers();
    this._updateAll();
    this.requestUpdate();
  }

  _saveRuntimeOptions() {
    const picked = {};
    for (const k of RUNTIME_KEYS) {
      if (this._config[k] !== undefined && this._config[k] !== null) {
        picked[k] = this._config[k];
      }
    }
    saveRuntimeOptions(picked);
  }

  // 运行时切换底图/样式/注记/路况：不重建 Map 实例（保留相机与覆盖物），
  // 只重建瓦片相关 source/layer；坐标系变化后重建 markers/圈/路径。
  _rebuildTileLayers() {
    if (!this._map) {
      return;
    }
    const config = this._config || {};
    const provider =
      TILE_PROVIDERS[config.provider] || TILE_PROVIDERS[DEFAULT_PROVIDER];
    this._provider = provider;
    const styleName =
      provider.styles[config.style] && config.style
        ? config.style
        : DEFAULT_STYLE;
    this._styleName = styleName;
    this._coordinateSystem =
      config.coordinate_system && config.coordinate_system !== "auto"
        ? config.coordinate_system
        : provider.coordinateSystem;

    if (provider.requiresKey && !config.tianditu_key) {
      this._error = {
        code: "tianditu_key",
        message: "天地图需要 tianditu_key（天地图官网免费申请）",
      };
      return;
    }

    // 移除旧瓦片/注记/路况层
    for (const id of ["tiles", "labels", "traffic"]) {
      try {
        if (this._map.getLayer(id)) {
          this._map.removeLayer(id);
        }
      } catch {
        /* ignore */
      }
      try {
        if (this._map.getSource(id)) {
          this._map.removeSource(id);
        }
      } catch {
        /* ignore */
      }
    }

    const styleConf = provider.styles[styleName];
    const urls =
      typeof styleConf.urls === "function"
        ? styleConf.urls(config.tianditu_key)
        : styleConf.urls;
    const maxZoom = Math.min(
      config.max_zoom || 18,
      styleConf.maxzoom || 18
    );
    this._map.addSource("tiles", {
      type: "raster",
      tiles: urls,
      tileSize: 256,
      maxzoom: maxZoom,
      attribution: provider.attribution,
    });
    this._map.addLayer({ id: "tiles", type: "raster", source: "tiles" });

    // 天地图注记叠加层（show_labels 开关）
    if (styleConf.labelUrls && config.show_labels !== false) {
      const labelUrls =
        typeof styleConf.labelUrls === "function"
          ? styleConf.labelUrls(config.tianditu_key)
          : styleConf.labelUrls;
      this._map.addSource("labels", {
        type: "raster",
        tiles: labelUrls,
        tileSize: 256,
        maxzoom: maxZoom,
        attribution: provider.attribution,
      });
      this._map.addLayer({ id: "labels", type: "raster", source: "labels" });
    }

    // 实时路况叠加层（仅高德 provider 提供）
    if (config.show_traffic && provider.traffic) {
      const tUrls =
        typeof provider.traffic.urls === "function"
          ? provider.traffic.urls(config.amap_key)
          : provider.traffic.urls;
      this._map.addSource("traffic", {
        type: "raster",
        tiles: tUrls,
        tileSize: 256,
        maxzoom: provider.traffic.maxzoom || 18,
        attribution: "&copy; 高德交通",
      });
      this._map.addLayer({ id: "traffic", type: "raster", source: "traffic" });
    }

    this._applyDarkFilter();
    // 坐标系可能变化（gcj02/wgs84），重建 markers/圈/路径
    this._updateAll();
  }

  _applyDarkFilter() {
    const isDark =
      this._config?.dark_mode || this._config?.theme_mode === "dark"
        ? true
        : this._config?.theme_mode === "light"
          ? false
          : (this.hass?.themes?.darkMode ?? false);
    const panel = this.layout === "panel";
    const rtl = computeRTL(this.hass);
    const canvas = this.shadowRoot?.querySelector(".maplibregl-canvas");
    if (!canvas) {
      return;
    }
    const satellite =
      this._styleName === "satellite" ||
      this._config?.style === "satellite";
    // 官方 map_style 预设（default/colorful/natural/muted/gray/toner）→ raster 滤镜近似
    const styleFilter =
      MAP_STYLE_FILTERS[this._config?.map_style || DEFAULT_MAP_STYLE] ?? "";
    // darkTile：该样式瓦片本身已是深色（如腾讯 styleid=4 夜景），暗色模式不再反相，
    // 仅微调亮度；浅色瓦片反相 invert+hue-rotate 成暗色（官方 ha-map 暗色模式等效做法）
    const darkTile = this._provider?.styles?.dark?.darkTile;
    const darkFilter = isDark
      ? satellite
        ? "brightness(0.85)"
        : darkTile
          ? "brightness(0.9)"
          : "invert(1) hue-rotate(180deg)"
      : "";
    canvas.style.filter = [darkFilter, styleFilter]
      .filter(Boolean)
      .join(" ");
  }

  _getAllEntities() {
    const hass = this.hass;
    if (!hass) {
      return [];
    }
    const personSources = new Set();
    const locationEntities = [];
    Object.values(hass.states).forEach((entity) => {
      if (!getEntityLocation(entity, hass.states)) {
        return;
      }
      locationEntities.push(entity.entity_id);
      if (computeDomain(entity.entity_id) === "person" && entity.attributes.source) {
        personSources.add(entity.attributes.source);
      }
    });
    return locationEntities.filter(
      (entityId) =>
        !hass.entities?.[entityId]?.hidden && !personSources.has(entityId)
    );
  }

  _getSourceEntities() {
    const states = this.hass?.states;
    const sourcesConfig = this._config?.geo_location_sources;
    if (!states || !sourcesConfig) {
      return [];
    }
    const sourceObjs = sourcesConfig.map((s) =>
      typeof s === "string" ? { source: s } : s
    );
    const entities = [];
    const allSource = sourceObjs.find((s) => s.source === "all");
    for (const stateObj of Object.values(states)) {
      const sourceObj = sourceObjs.find(
        (s) => s.source === stateObj.attributes.source
      );
      if (
        computeDomain(stateObj.entity_id) === "geo_location" &&
        (allSource || sourceObj)
      ) {
        entities.push({
          entity_id: stateObj.entity_id,
          label_mode: sourceObj?.label_mode ?? allSource?.label_mode,
          attribute: sourceObj?.attribute ?? allSource?.attribute,
          unit: sourceObj?.unit ?? allSource?.unit,
          focus: sourceObj
            ? (sourceObj.focus ?? true)
            : (allSource?.focus ?? true),
        });
      }
    }
    return entities;
  }

  _mapEntities() {
    const confEntities = (this._configEntities || []).map((e) => ({
      entity_id: e.entity,
      color: e.color,
      label_mode: e.label_mode,
      attribute: e.attribute,
      unit: e.unit,
      focus: e.focus,
      name: e.name,
    }));
    return [...confEntities, ...this._getSourceEntities()];
  }

  // 与官方一致：panel 布局下按概述 Tab 过滤实体
  // （person→人、device_tracker→设备，zone/geo_location 任何 Tab 都显示；选中实体恒显示）
  // 同时携带 hide_accuracy/hide_radius/selected 装饰（官方 _decorateOverviewEntities 语义：
  // panel 布局下只有选中实体显示精度圈/半径圈，除非预览/配置显示半径/zones Tab）
  _displayEntities() {
    const entities = this._mapEntities();
    if (this.layout !== "panel" || this.preview) {
      return entities;
    }
    const tab = this._overviewTab;
    const selected = this._overviewSelected;
    const showRadii =
      this.preview ||
      this._config?.show_zone_radius ||
      this._overviewTab === "zones";
    return entities
      .map((entity) => ({
        ...entity,
        hide_accuracy: entity.entity_id !== selected,
        hide_radius: !showRadii && entity.entity_id !== selected,
        selected: entity.entity_id === selected,
      }))
      .filter((e) => {
        if (e.entity_id === selected) {
          return true;
        }
        const domain = computeDomain(e.entity_id);
        if (domain === "person") {
          return tab === "people";
        }
        if (domain === "device_tracker") {
          return tab === "devices";
        }
        return true;
      });
  }

  // 与官方 _withMissingTracked 一致：show_all 冻结已定位实体，补上后续定位的人/独立 tracker
  _withMissingTracked(entities) {
    const hass = this.hass;
    if (!hass || !this._config?.show_all) {
      return entities;
    }
    const present = new Set(entities.map((entity) => entity.entity_id));
    const personSources = new Set();
    Object.values(hass.states).forEach((stateObj) => {
      if (
        computeDomain(stateObj.entity_id) === "person" &&
        stateObj.attributes.source
      ) {
        personSources.add(stateObj.attributes.source);
      }
    });
    const extra = [];
    Object.values(hass.states).forEach((stateObj) => {
      const entityId = stateObj.entity_id;
      const domain = computeDomain(entityId);
      const eligible =
        domain === "person" ||
        (domain === "device_tracker" && !personSources.has(entityId));
      if (
        eligible &&
        !present.has(entityId) &&
        !hass.entities?.[entityId]?.hidden &&
        this._meetsConditions(entityId)
      ) {
        extra.push({
          entity_id: entityId,
          color: this._entityColor(entityId, stateObj),
        });
      }
    });
    return extra.length ? [...entities, ...extra] : entities;
  }

  // 传给 overview 抽屉的实体：补漏 + 与官方 _decorateOverviewEntities 一致的装饰
  // （未选中的隐藏精度圈/半径圈，除非配置显示或区域 Tab；选中实体标记 selected）
  _overviewEntities() {
    const entities = this._mapEntities();
    let overview =
      this.layout === "panel" && !this.preview
        ? this._withMissingTracked(entities)
        : entities;
    const selected = this._overviewSelected;
    const showRadii =
      this.preview ||
      this._config?.show_zone_radius ||
      this._overviewTab === "zones";
    overview = overview.map((entity) => ({
      ...entity,
      hide_accuracy: entity.entity_id !== selected,
      hide_radius: !showRadii && entity.entity_id !== selected,
      selected: entity.entity_id === selected,
    }));
    return overview;
  }

  _handleOverviewTab(ev) {
    this._overviewTab = ev.detail.tab;
    this._updateAll();
  }

  _handleOverviewSelect(ev) {
    if (ev.detail.entityId) {
      this._select(ev.detail.entityId);
    } else {
      this._deselect();
    }
  }

  _handleOverviewResize(ev) {
    const { width, height } = ev.detail;
    const padding = this._overviewPadding();
    // 折叠时保留宽度但归零，不再预留空间（与官方一致）
    this._overviewSize = width && height ? ev.detail : { width: 0, height: 0 };
    // 选中态下抽屉尺寸变化 → 重新聚焦以应用新 padding
    if (this._overviewSelected && this._overviewPadding() !== padding) {
      this._focusEntity(this._overviewSelected);
    }
  }

  // ---------- 实体选择（与官方一致：URL entity_id 参数） ----------
  _syncSelection = () => {
    // 与官方一致：仅 panel 布局 + 当前路径一致（防止跨仪表盘误同步）
    if (
      this.layout !== "panel" ||
      (typeof window !== "undefined" &&
        window.location.pathname !== this._path)
    ) {
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      const entityId = params.get(SELECTED_ENTITY_PARAM);
      const selectable =
        !!entityId && SELECTABLE_DOMAINS.includes(computeDomain(entityId));
      if (entityId && !selectable) {
        params.delete(SELECTED_ENTITY_PARAM);
        const url = `${window.location.pathname}${
          params.toString() ? `?${params.toString()}` : ""
        }`;
        if (typeof history !== "undefined" && history.replaceState) {
          history.replaceState(null, "", url);
        }
        this._overviewSelected = undefined;
        this.requestUpdate();
        return;
      }
      const changed = (entityId || undefined) !== this._overviewSelected;
      this._overviewSelected = entityId || undefined;
      if (changed) {
        this.requestUpdate();
        if (this._overviewSelected) {
          this._focusEntity(this._overviewSelected);
        } else if (this._config?.auto_fit) {
          this._fitAll();
        }
      }
    } catch {
      /* 环境无 URL 时忽略 */
    }
  };

  _select(entityId) {
    if (entityId === this._overviewSelected) {
      this._focusEntity(entityId);
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      params.set(SELECTED_ENTITY_PARAM, entityId);
      const url = `${window.location.pathname}?${params.toString()}`;
      if (typeof history !== "undefined" && history.pushState) {
        history.pushState(null, "", url);
      }
      this._overviewSelected = entityId;
      this.requestUpdate();
      this._focusEntity(entityId);
    } catch {
      this._overviewSelected = entityId;
      this.requestUpdate();
      this._focusEntity(entityId);
    }
  }

  _deselect() {
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete(SELECTED_ENTITY_PARAM);
      const url = `${window.location.pathname}${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      if (typeof history !== "undefined" && history.pushState) {
        history.pushState(null, "", url);
      }
    } catch {
      /* ignore */
    }
    this._overviewSelected = undefined;
    this.requestUpdate();
    // 官方 #54774：取消选中恢复自动适配（auto_fit 开启时重新 fit 全部实体）
    if (this._config?.auto_fit && this._map) {
      this._autoFitted = false;
      this._updateAll();
    }
  }

  // 与官方 _focusEntity 一致：zone 用球面圆角点 fitBounds；单点按需放大到
  // 恰好清除最近标记（FOCUS_MAX_ZOOM=17），padding 避开 overview 抽屉
  _focusEntity(entityId) {
    const stateObj = this.hass?.states?.[entityId];
    const center = this._entityCenter(entityId);
    if (!stateObj || !center) {
      return;
    }
    // 底图是 GCJ-02（高德/腾讯/天地图）：聚焦中心必须做 WGS-84→GCJ-02 纠偏，
    // 否则 fitBounds 中心偏 ~0.006 度（数百米）
    const [mapLng, mapLat] = toMapCoords(
      center[0],
      center[1],
      this._coordinateSystem
    );
    const mapCenter = [mapLng, mapLat];
    const zoom = this._map?.getZoom();
    const zone = computeDomain(entityId) === "zone";
    // 官方 MapLatLng=[lat,lng]；maplibre fitBounds 期望 [lng,lat]
    const toLngLat = (p) => [p[1], p[0]];
    // 目标是否已在地图视野内（官方 fly 语义：在视野内不飞行直接跳转）
    const contains = this._map?.containsLocation?.(mapCenter);
    this._map?.fitBounds(
      zone
        ? circleBoundsPoints(mapCenter, stateObj.attributes.radius ?? 100).map(toLngLat)
        : [toLngLat(mapCenter)],
      {
        maxZoom: zone ? 16 : this._focusZoom(mapCenter, zoom),
        padding: this._overviewPadding() || { top: 40, bottom: 40, left: 40, right: 40 },
        fly: !contains,
      }
    );
  }

  _entityCenter(entityId) {
    const stateObj = this.hass?.states?.[entityId];
    const location = stateObj && getEntityLocation(stateObj, this.hass?.states);
    return location && [location.latitude, location.longitude];
  }

  // 与官方 _focusZoom 一致：只放大到清除最近的其他标记
  _focusZoom(center, zoom) {
    const FOCUS_MAX_ZOOM = 17;
    const FOCUS_CLEARANCE_PX = 80;
    if (zoom === undefined || !this._map) {
      return FOCUS_MAX_ZOOM;
    }
    let nearest = Infinity;
    for (const entity of this._displayEntities()) {
      const raw = this._entityCenter(entity.entity_id);
      if (!raw) {
        continue;
      }
      // 与 center 同坐标系（GCJ-02）：实体中心是 WGS-84，必须纠偏后再算像素距离
      const [olng, olat] = toMapCoords(raw[0], raw[1], this._coordinateSystem);
      if (olng !== center[0] || olat !== center[1]) {
        nearest = Math.min(nearest, pixelDistance(center, [olng, olat], zoom));
      }
    }
    return Math.max(
      zoom,
      Math.min(FOCUS_MAX_ZOOM, zoom + Math.log2(FOCUS_CLEARANCE_PX / nearest))
    );
  }

  // 与官方一致：fit 视野避开 overview 抽屉（桌面左侧/RTL 右侧 / 手机底部）
  _overviewPadding() {
    if (this.layout !== "panel") {
      return undefined;
    }
    const { width, height, fitHeight } = this._overviewSize;
    if (!width || !height) {
      return undefined;
    }
    const phone =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 600px)").matches;
    if (phone) {
      return { bottom: (fitHeight ?? height) + OVERVIEW_GAP };
    }
    const side = width + 2 * OVERVIEW_GAP;
    return computeRTL(this.hass) ? { right: side } : { left: side };
  }

  _meetsConditions(entityId) {
    const conditions = this._config?.conditions;
    if (!conditions) {
      return true;
    }
    return checkConditionsMet(
      conditions.map((c) => addEntityToCondition(c, entityId)),
      this.hass
    );
  }

  _entityColor(entityId, stateObj, forced) {
    const computed = getComputedStyle(this);
    if (computeDomain(entityId) === "zone") {
      return (
        forced ||
        zoneColor(
          entityId,
          !!stateObj?.attributes.passive,
          this._registryEntries(),
          computed
        )
      );
    }
    return forced || entityMapColor(entityId, this._registryEntries(), computed);
  }

  _registryEntries() {
    const hass = this.hass;
    if (!hass?.entities) {
      return [];
    }
    return Object.values(hass.entities).map((entry) => ({
      entity_id: entry.entity_id,
      id: entry.id,
      created_at: (() => {
        const t = Date.parse(entry.created_at);
        return Number.isNaN(t) ? 0 : t;
      })(),
    }));
  }

  _formatName(entityId, stateObj) {
    try {
      if (this.hass?.formatEntityName) {
        return this.hass.formatEntityName(stateObj) || entityId;
      }
    } catch {
      /* fallback */
    }
    return stateObj?.attributes?.friendly_name || entityId;
  }

  // 与官方 _handleMapMoreInfo 一致：panel 布局下点击可选实体 → 选择并 focus；否则打开详情
  _handleMarkerClick(entityId) {
    const selectable = SELECTABLE_DOMAINS.includes(computeDomain(entityId));
    const inFiltered =
      computeDomain(entityId) === "zone" ||
      this._displayEntities().some((e) => e.entity_id === entityId);
    if (this.layout === "panel" && entityId && selectable && inFiltered) {
      this._select(entityId);
      return;
    }
    this._fireMoreInfo(entityId);
  }

  _fireMoreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      })
    );
  }

  _updateAll() {
    if (!this._map || !this._mapLoaded || !this.hass) {
      return;
    }
    this._applyDarkFilter();
    this._reconcileMarkers();
    this._updateHistorySubscription();
    this._updatePaths();
    this._resizeCircles();
    this._applyClustering();
    // 选中实体时暂停自动适配（保持聚焦）；取消选中恢复（官方 #54774 unpause_autofit）
    if (this._config?.auto_fit && !this._autoFitted && !this._overviewSelected) {
      this._autoFitted = true;
      this._fitAll();
    }
  }

  _reconcileMarkers() {
    const states = this.hass.states;
    const entries = this._displayEntities().filter((e) =>
      this._meetsConditions(e.entity_id)
    );
    const drawn = new Set();
    const fitPoints = [];

    for (const entity of entries) {
      const stateObj = states[entity.entity_id];
      if (!stateObj) {
        continue;
      }
      const location = getEntityLocation(stateObj, states);
      if (!location) {
        continue;
      }
      const { latitude, longitude, gpsAccuracy } = location;
      const [mapLng, mapLat] = toMapCoords(
        latitude,
        longitude,
        this._coordinateSystem
      );
      const color = this._entityColor(
        entity.entity_id,
        stateObj,
        entity.color
      );
      drawn.add(entity.entity_id);
      fitPoints.push([mapLng, mapLat]);

      if (computeDomain(entity.entity_id) === "zone") {
        if (this._config?.show_zones === false) {
          // 隐藏区域圈层：不绘制，旧圈由下方移除循环清理
          continue;
        }
        this._drawZone(entity, stateObj, [mapLng, mapLat], color);
        continue;
      }
      this._drawEntityMarker(
        entity,
        stateObj,
        [mapLng, mapLat],
        color,
        gpsAccuracy
      );
    }

    // 移除不再显示的实体
    for (const entityId of Object.keys(this._entityMarkers)) {
      if (!drawn.has(entityId)) {
        this._removeEntityMarker(entityId);
      }
    }
    for (const entityId of Object.keys(this._zoneMarkers)) {
      if (!drawn.has(entityId)) {
        this._removeZone(entityId);
      }
    }

    this._entityCount = Object.keys(this._entityMarkers).length;
    this._fitPoints = fitPoints;
  }

  _drawEntityMarker(entity, stateObj, position, color, gpsAccuracy) {
    const entityId = entity.entity_id;
    const existing = this._entityMarkers[entityId];

    const title = entity.name || this._formatName(entityId, stateObj);
    const entityName =
      entity.label_mode === "state"
        ? this._formatState(stateObj)
        : entity.label_mode === "attribute" && entity.attribute !== undefined
          ? String(stateObj.attributes[entity.attribute] ?? "")
          : title
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 3);
    const picture =
      stateObj.attributes.entity_picture &&
      (typeof entity !== "object" || !entity.label_mode)
        ? this.hass.hassUrl(stateObj.attributes.entity_picture)
        : "";
    const unit =
      entity.label_mode === "attribute" && entity.unit ? entity.unit : "";

    if (existing) {
      existing.marker.setLngLat(position);
      existing.color = color;
      existing.element.style.setProperty("--ha-marker-color", color);
      const markerDiv = existing.element.querySelector(".map-cn-marker");
      if (markerDiv) {
        markerDiv.style.borderColor = color;
        markerDiv.style.setProperty("--ha-marker-color", color);
      }
      // label_mode=state/attribute 时状态变化需刷新标签文本（name 模式不变）
      if (entityName !== existing.entityName) {
        existing.entityName = entityName;
        if (markerDiv) {
          const unitSpan = markerDiv.querySelector(".map-cn-marker-unit");
          if (unitSpan) {
            const firstSpan = markerDiv.querySelector("span");
            if (firstSpan) {
              firstSpan.textContent = entityName + " ";
            }
            unitSpan.textContent = unit;
          } else if (
            !markerDiv.querySelector(".map-cn-marker-picture") &&
            !markerDiv.querySelector("ha-icon")
          ) {
            markerDiv.textContent = entityName;
          }
        }
        // title 同步（官方 marker 悬停提示显示实体名）
        if (title) {
          existing.element.title = title;
        }
      }
      // 精度圈同步（hide_accuracy / gps_accuracy 变化）
      this._syncAccuracyCircle(
        entityId,
        position,
        color,
        gpsAccuracy,
        entity.focus,
        entity.hide_accuracy
      );
      return;
    }

    const el = this._createEntityMarkerEl({
      entityId,
      entityName,
      unit,
      picture,
      showIcon: entity.label_mode === "icon",
      color,
      stateObj,
      title,
    });
    const marker = new maplibregl.Marker({
      element: el,
      anchor: "bottom",
      offset: [0, -6],
    })
      .setLngLat(position)
      .addTo(this._map);

    this._entityMarkers[entityId] = {
      marker,
      element: el,
      position,
      color,
      entityName,
    };

    // 精度圈（官方语义：panel 布局未选中实体隐藏；有 gps_accuracy 时显示）
    this._syncAccuracyCircle(
      entityId,
      position,
      color,
      gpsAccuracy,
      entity.focus,
      entity.hide_accuracy
    );
  }

  // 精度圈同步：创建/更新/移除（跟随选中态与 gps_accuracy 变化）
  _syncAccuracyCircle(entityId, position, color, gpsAccuracy, focus, hideAccuracy) {
    const em = this._entityMarkers[entityId];
    if (!em) {
      return;
    }
    const shouldHide = hideAccuracy && this.layout === "panel";
    const accuracy =
      !shouldHide && gpsAccuracy
        ? gpsAccuracy
        : !shouldHide && focus
          ? NOMINAL_ACCURACY
          : 0;
    const have = !!em.accuracyMarker;
    if (accuracy > 0 && !have) {
      const circleEl = this._createCircleEl(color, 1);
      circleEl.style.display = "none";
      const circleMarker = new maplibregl.Marker({
        element: circleEl,
      })
        .setLngLat(position)
        .addTo(this._map);
      em.accuracyEl = circleEl;
      em.accuracyMarker = circleMarker;
      em.accuracy = accuracy;
    } else if (accuracy > 0 && have) {
      em.accuracy = accuracy;
      if (em.accuracyMarker) {
        em.accuracyMarker.setLngLat(position);
      }
    } else if (accuracy <= 0 && have) {
      em.accuracyMarker?.remove();
      em.accuracyMarker = undefined;
      em.accuracyEl = undefined;
      em.accuracy = 0;
    }
  }

  _createEntityMarkerEl({
    entityId,
    entityName,
    unit,
    picture,
    showIcon,
    color,
    stateObj,
    title,
  }) {
    const wrap = document.createElement("div");
    wrap.className = "map-cn-marker-wrap";
    wrap.title = title;

    const marker = document.createElement("div");
    marker.className = "map-cn-marker";
    marker.style.borderColor = color;
    marker.style.setProperty("--ha-marker-color", color);

    if (picture) {
      const pic = document.createElement("div");
      pic.className = "map-cn-marker-picture";
      pic.style.backgroundImage = `url(${picture})`;
      marker.appendChild(pic);
    } else if (showIcon) {
      const icon = document.createElement("ha-icon");
      icon.setAttribute(
        "icon",
        stateObj?.attributes?.icon || defaultIconForDomain(entityId)
      );
      marker.appendChild(icon);
    } else if (unit) {
      const span = document.createElement("span");
      span.textContent = entityName + " ";
      marker.appendChild(span);
      const unitSpan = document.createElement("span");
      unitSpan.className = "map-cn-marker-unit";
      unitSpan.textContent = unit;
      marker.appendChild(unitSpan);
    } else {
      marker.textContent = entityName;
    }

    const tail = document.createElement("div");
    tail.className = "map-cn-marker-tail";
    tail.style.background = color;
    const dot = document.createElement("div");
    dot.className = "map-cn-marker-dot";
    dot.style.background = color;

    wrap.appendChild(marker);
    wrap.appendChild(tail);
    wrap.appendChild(dot);

    wrap.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._handleMarkerClick(entityId);
    });
    wrap.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        this._handleMarkerClick(entityId);
      }
    });
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "button");
    return wrap;
  }

  _drawZone(entity, stateObj, position, color) {
    const entityId = entity.entity_id;
    const existing = this._zoneMarkers[entityId];
    const passive = !!stateObj.attributes.passive;
    const radius = stateObj.attributes.radius;
    // 官方语义：panel 布局下未选中 zone 隐藏半径圈（hide_radius）
    const showRadius =
      !(entity.hide_radius && this.layout === "panel") && !!radius;

    if (existing) {
      existing.marker.setLngLat(position);
      if (existing.radiusMarker) {
        if (showRadius) {
          existing.radiusMarker.setLngLat(position);
          existing.radius = radius;
          if (existing.radiusEl) {
            existing.radiusEl.style.borderColor = color;
          }
        } else {
          existing.radiusMarker.remove();
          existing.radiusMarker = undefined;
          existing.radiusEl = undefined;
          existing.radius = 0;
        }
      } else if (showRadius) {
        const radiusEl = this._createCircleEl(color, 1);
        radiusEl.style.display = "none";
        const radiusMarker = new maplibregl.Marker({
          element: radiusEl,
          anchor: "center",
        })
          .setLngLat(position)
          .addTo(this._map);
        existing.radiusEl = radiusEl;
        existing.radiusMarker = radiusMarker;
        existing.radius = radius;
      }
      return;
    }

    const circleEl = document.createElement("div");
    circleEl.className = "map-cn-zone-circle";
    circleEl.style.backgroundColor = color;
    circleEl.style.color = contrastingContent(color);
    if (stateObj.attributes.icon) {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", stateObj.attributes.icon);
      circleEl.appendChild(icon);
    } else {
      const initials = document.createElement("span");
      // home zone（zone.home）显示「家」标签（home_label 可自定义，借鉴 ha-china-map）
      const zoneName =
        entityId === "zone.home"
          ? this._config?.home_label || "家"
          : entity.name || this._formatName(entityId, stateObj);
      initials.textContent = zoneInitials(zoneName);
      circleEl.appendChild(initials);
    }
    circleEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._handleMarkerClick(entityId);
    });

    const marker = new maplibregl.Marker({
      element: circleEl,
      anchor: "center",
    })
      .setLngLat(position)
      .addTo(this._map);

    const zone = {
      marker,
      element: circleEl,
      position,
      color,
      radius: radius || 0,
      radiusEl: null,
      radiusMarker: null,
    };

    if (showRadius) {
      const radiusEl = this._createCircleEl(color, 1);
      radiusEl.style.display = "none";
      const radiusMarker = new maplibregl.Marker({
        element: radiusEl,
        anchor: "center",
      })
        .setLngLat(position)
        .addTo(this._map);
      zone.radiusEl = radiusEl;
      zone.radiusMarker = radiusMarker;
    }
    this._zoneMarkers[entityId] = zone;
  }

  _createCircleEl(color, px) {
    const el = document.createElement("div");
    el.className = "map-cn-circle";
    el.style.width = `${px * 2}px`;
    el.style.height = `${px * 2}px`;
    el.style.border = `2px solid ${color}`;
    el.style.borderRadius = "50%";
    el.style.boxSizing = "border-box";
    el.style.pointerEvents = "none";
    return el;
  }

  _metersToPixels(meters, lat) {
    const zoom = this._map.getZoom();
    const mpp =
      (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) /
      (256 * Math.pow(2, zoom));
    return Math.max(1, meters / mpp);
  }

  _resizeCircles() {
    if (!this._map) {
      return;
    }
    // 实体精度圈
    for (const entityId of Object.keys(this._entityMarkers)) {
      const em = this._entityMarkers[entityId];
      if (em.accuracyEl && em.accuracyMarker) {
        const px = this._metersToPixels(em.accuracy, em.position[1]);
        em.accuracyEl.style.width = `${px * 2}px`;
        em.accuracyEl.style.height = `${px * 2}px`;
        em.accuracyEl.style.display = "block";
      }
    }
    // zone 半径圈（尺寸计算；显示/隐藏由 _drawZone 按官方 hide_radius 语义管理——
    // 选中 zone 恒显示，未选中 zone 仅在 show_zone_radius/preview/zones Tab 时显示）
    for (const zoneId of Object.keys(this._zoneMarkers)) {
      const z = this._zoneMarkers[zoneId];
      if (z.radiusEl && z.radiusMarker && z.radius) {
        const px = this._metersToPixels(z.radius, z.position[1]);
        z.radiusEl.style.width = `${px * 2}px`;
        z.radiusEl.style.height = `${px * 2}px`;
        z.radiusEl.style.display = "block";
      }
    }
  }

  _removeEntityMarker(entityId) {
    const em = this._entityMarkers[entityId];
    if (!em) {
      return;
    }
    em.marker.remove();
    em.accuracyMarker?.remove();
    delete this._entityMarkers[entityId];
  }

  _removeZone(entityId) {
    const z = this._zoneMarkers[entityId];
    if (!z) {
      return;
    }
    z.marker.remove();
    z.radiusMarker?.remove();
    delete this._zoneMarkers[entityId];
  }

  // ---------- 历史轨迹 ----------
  _updateHistorySubscription() {
    const hours = this._config?.hours_to_show;
    const entityIds = (this._configEntities || [])
      .map((e) => e.entity)
      .filter((e) => computeDomain(e) !== "zone");
    if (hours && entityIds.length && !this._subscribed) {
      this._subscribed = true;
      this._historyUnsub = subscribeHistory(
        this.hass,
        entityIds,
        hours,
        (states) => {
          this._history = states;
          this._updatePaths();
        }
      ).catch((err) => {
        this._subscribed = false;
        console.error("map-cn history subscribe failed", err);
        return undefined;
      });
    } else if (!hours && this._subscribed) {
      this._unsubscribeHistory();
    }
  }

  _unsubscribeHistory() {
    if (this._historyUnsub) {
      this._historyUnsub.then((unsub) => unsub?.()).catch(() => undefined);
      this._historyUnsub = undefined;
    }
    this._subscribed = false;
  }

  _updatePaths() {
    if (!this._map) {
      return;
    }
    for (const layerId of Object.keys(this._pathLayers)) {
      try {
        this._map.removeLayer(layerId);
      } catch {
        /* ignore */
      }
      try {
        this._map.removeSource(layerId);
      } catch {
        /* ignore */
      }
    }
    this._pathLayers = {};
    if (!this._history || !this._config?.hours_to_show) {
      return;
    }
    for (const entityId of Object.keys(this._history)) {
      if (computeDomain(entityId) === "zone") {
        continue;
      }
      const points = extractPathPoints(this._history[entityId])
        .map((p) => toMapCoords(p.lat, p.lng, this._coordinateSystem))
        .filter((p) => p[0] && p[1]);
      if (points.length < 2) {
        continue;
      }
      const stateObj = this.hass.states[entityId];
      // track_color 配置可统一轨迹颜色（默认跟随实体颜色）
      const color =
        this._config?.track_color || this._entityColor(entityId, stateObj);
      const layerId = `path-${entityId}`;
      this._map.addSource(layerId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: points,
          },
        },
      });
      this._map.addLayer({
        id: layerId,
        type: "line",
        source: layerId,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": color,
          "line-opacity": 0.8,
          "line-width": 4,
        },
      });
    }
  }

  // ---------- 聚合 ----------
  _applyClustering() {
    if (!this._map || !this._mapLoaded) {
      return;
    }
    // 清除旧聚合
    for (const cid of Object.keys(this._clusterMarkers)) {
      this._clusterMarkers[cid].marker.remove();
    }
    this._clusterMarkers = {};

    if (!this._clusterEnabled) {
      for (const entityId of Object.keys(this._entityMarkers)) {
        this._entityMarkers[entityId].element.style.visibility = "";
      }
      return;
    }

    const entries = Object.entries(this._entityMarkers).map(
      ([entityId, em]) => ({
        entityId,
        position: em.position,
        screen: this._map.project(em.position),
        em,
      })
    );
    if (entries.length < 2) {
      for (const e of entries) {
        e.em.element.style.visibility = "";
      }
      return;
    }

    // 贪心分组
    const groups = [];
    for (const entry of entries) {
      let joined = false;
      for (const group of groups) {
        const dx = group.center.x - entry.screen.x;
        const dy = group.center.y - entry.screen.y;
        if (Math.hypot(dx, dy) <= CLUSTER_RADIUS_PX) {
          group.members.push(entry);
          group.center.x =
            (group.center.x * (group.members.length - 1) +
              entry.screen.x) /
            group.members.length;
          group.center.y =
            (group.center.y * (group.members.length - 1) +
              entry.screen.y) /
            group.members.length;
          joined = true;
          break;
        }
      }
      if (!joined) {
        groups.push({
          members: [entry],
          center: { x: entry.screen.x, y: entry.screen.y },
        });
      }
    }

    for (const group of groups) {
      if (group.members.length === 1) {
        group.members[0].em.element.style.visibility = "";
        continue;
      }
      const centroid = this._map.unproject([group.center.x, group.center.y]);
      for (const m of group.members) {
        m.em.element.style.visibility = "hidden";
      }
      const el = this._createClusterEl(group.members);
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat(centroid)
        .addTo(this._map);
      this._clusterMarkers[`c${this._clusterSeq++}`] = { marker, el };
    }
  }

  _createClusterEl(members) {
    const el = document.createElement("div");
    el.className = "map-cn-cluster";
    const bubble = document.createElement("div");
    bubble.className = "map-cn-cluster-bubble";
    members.slice(0, 4).forEach((m) => {
      const a = document.createElement("div");
      a.className = "map-cn-cluster-avatar";
      a.style.borderColor = m.em.color;
      const el2 = m.em.element.querySelector(".map-cn-marker");
      const text = el2?.textContent || "";
      a.textContent = text.slice(0, 1);
      bubble.appendChild(a);
    });
    el.appendChild(bubble);
    if (members.length > 4) {
      const count = document.createElement("div");
      count.className = "map-cn-cluster-count";
      count.textContent = `+${members.length - 4}`;
      el.appendChild(count);
    }
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const zoom = this._map.getZoom();
      this._map.easeTo({ zoom: Math.min(zoom + 2, 18) });
    });
    return el;
  }

  _toggleCluster() {
    this._clusterEnabled = !this._clusterEnabled;
    this._applyClustering();
    this.requestUpdate();
  }

  // ---------- 视野 ----------
  _fitAll() {
    if (!this._map || !this._fitPoints?.length) {
      return;
    }
    const points = [...this._fitPoints];
    if (this._config?.fit_zones) {
      for (const z of Object.values(this._zoneMarkers)) {
        points.push(z.position);
      }
    }
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((p) => bounds.extend(p));
    this._map.fitBounds(bounds, {
      padding: this._overviewPadding() || { top: 40, bottom: 40, left: 40, right: 40 },
      maxZoom: 16,
    });
  }

  _resetFocus() {
    if (!this._map) {
      return;
    }
    if (this._fitPoints?.length) {
      this._fitAll();
    } else {
      this._map.setCenter(DEFAULT_CENTER);
      this._map.setZoom(DEFAULT_CENTER_ZOOM);
    }
  }

  _formatState(stateObj) {
    try {
      if (this.hass?.formatEntityState) {
        return this.hass.formatEntityState(stateObj);
      }
    } catch {
      /* fallback */
    }
    return String(stateObj.state ?? "");
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      --ha-marker-size: 48px;
    }
    ha-card {
      overflow: hidden;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    #card:has(#root.panel-layout) {
      overflow: visible;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    #root {
      position: relative;
      width: 100%;
      /* 默认 1:1，由 _updateAspectRatio 按配置覆盖 */
      padding-bottom: 100%;
    }
    #root.panel-layout {
      height: 100%;
      padding-bottom: 0;
      --map-bleed-left: var(--view-container-inset-left, 0px);
      --map-bleed-right: var(--view-container-inset-right, 0px);
      --map-bleed-bottom: var(--view-container-inset-bottom, 0px);
    }
    .map-cn-map {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      border-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg));
      overflow: hidden;
    }
    #root.panel-layout .map-cn-map {
      left: calc(-1 * var(--map-bleed-left));
      right: calc(-1 * var(--map-bleed-right));
      bottom: calc(-1 * var(--map-bleed-bottom));
      width: auto;
      height: auto;
    }
    /* 深色模式：对瓦片画布做滤镜（HTML 标记不受影响） */
    .maplibregl-canvas {
      transition: filter 0.3s;
    }
    /* Overview 抽屉（与官方一致：桌面左侧 / 手机底部；单 Tab 时收窄） */
    #overview {
      position: absolute;
      top: 12px;
      inset-inline-start: 12px;
      width: min(360px, calc(100% - 24px));
      max-height: calc(100% - 24px);
      display: flex;
      z-index: 2;
    }
    #overview[single-tab] {
      width: min(300px, calc(100% - 24px));
    }
    #root.panel-layout .map-cn-map {
      --ha-map-left-inset: calc(
        var(--overview-width, 0px) + 2 * var(--ha-space-3, 12px) +
          var(--map-bleed-left)
      );
      --ha-map-right-inset: var(--map-bleed-right);
      --ha-map-bottom-inset: var(--map-bleed-bottom);
    }
    #root.panel-layout.rtl .map-cn-map {
      --ha-map-left-inset: var(--map-bleed-left);
      --ha-map-right-inset: calc(
        var(--overview-width, 0px) + 2 * var(--ha-space-3, 12px) +
          var(--map-bleed-right)
      );
    }
    @media (max-width: 600px) {
      #overview,
      #overview[single-tab] {
        top: auto;
        bottom: 0;
        inset-inline-start: 0;
        inset-inline-end: 0;
        width: auto;
        max-height: 70%;
        border-radius: 12px 12px 0 0;
      }
      #root.panel-layout .map-cn-map,
      #root.panel-layout.rtl .map-cn-map {
        --ha-map-left-inset: var(--map-bleed-left);
        --ha-map-right-inset: var(--map-bleed-right);
        --ha-map-bottom-inset: calc(
          var(--overview-height, 0px) + var(--ha-space-2, 8px)
        );
      }
    }
    #buttons {
      position: absolute;
      top: 75px;
      left: 3px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 1;
    }
    #buttons.rtl {
      left: auto;
      right: 3px;
    }
    /* 与官方一致：panel 布局下按钮移到抽屉对侧 */
    #root.panel-layout #buttons {
      left: auto;
      inset-inline-start: auto;
      inset-inline-end: 3px;
    }
    /* ---- 面板工具栏（借鉴 ha-china-map .hcm-toolbar） ---- */
    .map-cn-toolbar {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 2px;
      background: var(--card-background-color, #fff);
      border-radius: 999px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
      padding: 4px 6px;
      z-index: 10;
      max-width: calc(100% - 24px);
      overflow-x: auto;
    }
    .map-cn-tool {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--primary-text-color, #212121);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .map-cn-tool:hover {
      background: var(--secondary-background-color, #e0e0e0);
    }
    .map-cn-tool.active {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }
    .map-cn-tool ha-icon {
      --mdc-icon-size: 18px;
    }
    .map-cn-sep {
      width: 1px;
      height: 20px;
      background: var(--divider-color, #ccc);
      margin: 0 2px;
    }
    /* ---- 图例 ---- */
    .map-cn-legend {
      position: absolute;
      bottom: 20px;
      left: 12px;
      z-index: 9;
      background: var(--card-background-color, #fff);
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
      padding: 6px 12px;
      font-size: 12px;
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .map-cn-legend i {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 4px;
      vertical-align: -1px;
    }
    #root.rtl .map-cn-toolbar {
      left: auto;
      right: 50%;
      transform: translateX(50%);
    }
    #root.rtl .map-cn-legend {
      left: auto;
      right: 12px;
    }
    /* ---- 实体标记（复刻官方 ha-entity-marker） ---- */
    .map-cn-marker-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.12));
      outline: none;
    }
    .map-cn-marker {
      display: flex;
      justify-content: center;
      text-align: center;
      align-items: center;
      box-sizing: border-box;
      width: var(--ha-marker-size, 48px);
      height: var(--ha-marker-size, 48px);
      font-size: var(--ha-marker-font-size, var(--ha-font-size-xl));
      border-radius: var(--ha-marker-border-radius, 50%);
      border: var(--ha-marker-border-width, 3px) solid
        var(--ha-marker-color, var(--card-background-color, #fff));
      color: var(--primary-text-color);
      background-color: var(--ha-marker-background, var(--card-background-color));
      overflow: hidden;
      pointer-events: auto;
      position: relative;
      z-index: 1;
    }
    .map-cn-marker-picture {
      background-size: cover;
      height: 100%;
      width: 100%;
    }
    .map-cn-marker-unit {
      margin-left: 2px;
    }
    .map-cn-marker-tail {
      width: 12px;
      height: 12px;
      margin-top: -6px;
      margin-bottom: 2px;
      border-radius: 2px;
      transform: rotate(45deg);
      pointer-events: none;
    }
    .map-cn-marker-dot {
      width: 10px;
      height: 10px;
      margin-top: 4px;
      border-radius: 50%;
      pointer-events: none;
    }
    /* ---- zone 圆圈 ---- */
    .map-cn-zone-circle {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--card-background-color, #fff);
      box-sizing: border-box;
      box-shadow: var(--ha-box-shadow-s);
      overflow: hidden;
      font-size: var(--ha-font-size-s);
      font-weight: var(--ha-font-weight-medium);
      --mdc-icon-size: 18px;
      cursor: pointer;
    }
    .map-cn-circle {
      pointer-events: none;
    }
    /* ---- 聚合 ---- */
    .map-cn-cluster {
      display: flex;
      align-items: center;
      cursor: pointer;
    }
    .map-cn-cluster-bubble {
      display: flex;
      background: var(--card-background-color, #fff);
      border-radius: 20px;
      padding: 3px;
      box-shadow: var(--ha-box-shadow-m, 0 2px 8px rgba(0, 0, 0, 0.2));
    }
    .map-cn-cluster-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid var(--card-background-color, #fff);
      background: var(--card-background-color);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      margin-left: -6px;
      box-sizing: border-box;
    }
    .map-cn-cluster-avatar:first-child {
      margin-left: 0;
    }
    .map-cn-cluster-count {
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      border-radius: 12px;
      padding: 2px 6px;
      font-size: 11px;
      font-weight: 500;
      margin-left: 4px;
    }
  `;
}

if (!customElements.get("map-cn")) {
  customElements.define("map-cn", MapCnCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "map-cn",
  name: "中国地图卡片",
  description:
    "HA 地图中国版：高德/腾讯/天地图底图，功能与官方地图卡片一致",
  preview: false,
  documentationURL: "https://github.com/RockJesus/ha-map-cn",
});

// 注册「中国地图」仪表盘模板（设置→仪表盘→添加仪表盘 对话框直接可选，全程 UI）
registerMapCnDashboardStrategy();

export { MapCnCard };
export { TILE_PROVIDERS, DEFAULT_PROVIDER, DEFAULT_STYLE } from "./tiles.js";
export { personActivity, zoneActivity } from "./map-cn-overview.js";
