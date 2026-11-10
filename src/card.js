/* ---- HaCnMapCard：Lovelace 卡片主类 ---- */

import {
  GCJ, OFFLINE_STATES, RUNTIME_KEYS, storageKey, loadRuntime, saveRuntime,
  LAYOUT, ICONS, BASEMAPS, escapeHtml, escapeAttr,
} from "./shared.js";
import { CnTileEngine } from "./engine.js";

class HaCnMapCard extends HTMLElement {
  static getStubConfig() {
    return { show_all: true };
  }
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._preview = false;    // 官方 preview 属性：卡片选择器/编辑器预览态
    this._trackPoints = {};   // entityId -> [{lat,lng}]
    this._trackUnsub = null;  // history 订阅取消函数
    this._trackSig = "";      // 订阅参数签名，避免重复订阅
    this._hiddenIds = null;   // 实体注册表里 hidden_by 非空的实体集合；null = 尚未拉取
    this._registryTried = false; // 注册表只拉一次，失败（权限/旧版本 HA）不重试
    // 官方交互：首次点标记 = 聚焦飞行 + 选中；设 false 恢复"直接弹 more-info"
    this._focusOnMarkerClick = true;
    this._bleedUser = undefined; // 用户点全屏按钮的选择：true 铺满 / false 不铺满 / undefined 自动
    this._isBleed = false;
    // Esc 退出全屏（事件从 shadow 里冒泡上来，composed 事件才有）
    this.addEventListener("keydown", this._onKeyBleed = (e) => {
      if (e.key === "Escape" && this.classList.contains("cmc-bleed")) {
        this._bleedUser = false;
        this._applyBleed(false);
      }
    });
  }

  /* hui-card 在 panel 视图里会直接给卡片元素赋 layout="panel"（官方卡片同样读这个属性） */
  get layout() { return this._hLayout; }
  set layout(v) {
    const old = this._hLayout;
    this._hLayout = v;
    if (old !== v && this._config && this.isConnected) {
      Promise.resolve().then(() => this._syncLayout());
    }
  }
  get isPanel() { return this._hLayout === "panel"; }
  // hui-card 还会顺手写 element.isPanel；只读会抛错（它有 try/catch，抛了就把卡片换成错误卡），给个空 setter
  set isPanel(_v) {}

  /* 官方卡片 API：preview=true 表示这张卡正被渲染在卡片选择器/编辑器里。
     预览态不该真的去订阅历史轨迹（那是一次 WebSocket 请求），也不该铺满全屏 */
  get preview() { return this._preview; }
  set preview(v) {
    const on = !!v;
    if (on === this._preview) return;
    this._preview = on;
    if (on && this._engine) {
      if (this._trackUnsub) { this._trackUnsub(); this._trackUnsub = null; }
      this._trackSig = "";
      this._trackPoints = {};
    }
  }

  /* 官方 hui-map-card 的字段名与我们的内部字段对齐（2026.11 MapCardConfig）。
     同名概念优先用户写的内部字段；只做单向别名，不改写用户原始 YAML。 */
  _applyAliases(raw) {
    const c = { ...raw };
    // auto_fit: true → 自动适配实体；"zones" → 只适配区域
    if (c.auto_fit !== undefined && c.fit_entities === undefined) {
      c.fit_entities = c.auto_fit !== "zones" && c.auto_fit !== false;
      if (c.fit_zones === undefined) c.fit_zones = c.auto_fit === "zones" || c.auto_fit === "all";
    }
    // cluster → 标记聚合
    if (c.cluster !== undefined && c.show_cluster === undefined) c.show_cluster = !!c.cluster;
    // scale_ruler → 比例尺（官方默认关，我们保留常显，显式 false 才关）
    if (c.scale_ruler !== undefined && c.show_scale === undefined) c.show_scale = !!c.scale_ruler;
    // map_style: auto|light|dark 映射主题；streets|satellite 映射底图
    const ms = typeof c.map_style === "string" ? c.map_style.trim().toLowerCase() : "";
    if (ms) {
      if (c.theme_mode === undefined && (ms === "auto" || ms === "light" || ms === "dark")) c.theme_mode = ms;
      if (c.basemap === undefined) {
        if (ms === "satellite") c.basemap = "amap-satellite";
        else if (ms === "streets" || ms === "auto" || ms === "light" || ms === "dark") c.basemap = "amap";
      }
    }
    // dark_mode: true/false → 主题
    if (c.dark_mode !== undefined && c.theme_mode === undefined) c.theme_mode = c.dark_mode ? "dark" : "light";
    return c;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("ha-cn-map-card: 配置无效");
    this._rawConfig = config;
    this._config = {
      basemap: "amap",            // amap | amap-satellite | tianditu | tianditu-satellite | osm
      tianditu_key: "",
      default_zoom: 12,
      hours_to_show: 0,          // >0 时绘制轨迹线
      track_width: 3,
      track_opacity: 0.85,
      show_traffic: false,       // 高德实时路况叠加
      show_all: true,            // 全部可定位实体（对齐官方地图卡：默认全显示）
      show_zones: true,          // 默认显示区域（家）
      hidden_entities: [],       // 设置里逐个取消勾选的实体（永远不上图）
      home_lat: undefined,       // 家的坐标/半径覆盖（留空则用 zone.home 自身属性）
      home_lng: undefined,
      home_radius: undefined,
      home_address: "",
      show_zone_radius: true,    // zone 半径圈（官方把半径当 zone 的核心属性）
      dedupe_trackers: true,     // person 已覆盖的 device_tracker 不再单独画点
      respect_hidden: true,      // 实体注册表里被用户隐藏（hidden_by）的实体不再上地图
      fit_zones: false,          // 自动适配视野时把区域半径圈也算进去
      show_labels: true,
      label_mode: "name",        // name | state | attribute | none（可在 entities 里逐实体覆盖）
      show_status: true,         // 标记下方状态行（在家 / 离线 / 速度 / 电量 / 相对时间）
      show_accuracy: true,       // GPS 精度圈（gps_accuracy，对齐官方）
      show_cluster: true,        // 标记聚合
      fit_entities: true,
      height: 360,
      aspect_ratio: "",          // 如 "16:9"，填了就忽略 height（官方 aspect_ratio 语义）
      entities: [],
      conditions: [],            // 条件显示：每条都满足才渲染，否则整卡隐藏（官方条件卡片语义）
      geo_location_sources: [],
      title: "",
      theme_mode: "auto",        // auto（跟随 HA 主题）| light | dark
      show_scale: true,          // 比例尺（官方字段 scale_ruler，显式 false 才关）
      ...this._applyAliases(config),
    };
    // 本地保存的运行时设置（设置抽屉/快捷按钮改过的）优先于 YAML
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
    // HA 2024.10+ 已经把 zone.edit 服务移除了（zone 域只剩 reload），提前缓存一下，
    // 拖动 home 后不再盲调一个不存在的服务、再弹「未找到 zone.edit 动作」
    this._zoneEditSupported = !!(hass?.services?.zone?.edit);
    // 主题可能是 auto：hass.themes.darkMode 变了要立刻切（不必重建整张卡片）
    const dark = this._resolveDark();
    if (dark !== this._dark) {
      this._dark = dark;
      this.shadowRoot?.querySelector(".cmc-card")?.classList.toggle("is-dark", dark);
    }
    if (this._engine) this._update();
    // 用户在 HA 设置里隐藏的实体不该出现在地图上（官方 hui-map-card 同样查注册表）。
    // 注册表是一次异步请求，回来自动触发一次重绘
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
    Promise.resolve()
      .then(() => conn.sendMessagePromise({ type: "config/entity_registry/list" }))
      .then((entries) => {
        this._hiddenIds = new Set(
          (entries || []).filter((e) => e?.hidden_by).map((e) => e.entity_id)
        );
        if (this._hiddenIds.size && this._config?.respect_hidden !== false && this._engine) this._update();
      })
      .catch(() => { this._hiddenIds = new Set(); });
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
    this.style.height = this._isFull ? "" : r ? "auto" : `${this._config?.height || 360}px`;
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
      if (opts[k] !== undefined) cfg[k] = opts[k];
    });
    // 清理之前 NaN/异常的 home 覆盖值（老版本拖动半径写脏过）
    for (const k of ["home_lat", "home_lng", "home_radius"]) {
      const v = cfg[k];
      if (v !== undefined && v !== null && v !== "" && !Number.isFinite(Number(v))) delete cfg[k];
    }
    this._config = cfg;
  }

  /* 把当前配置里"运行时可变"的键落盘，下次刷新/切视图仍生效 */
  _saveRuntime() {
    if (this._rawConfig?.persist === false) return;
    const out = {};
    RUNTIME_KEYS.forEach((k) => {
      // 注意：false / 0 都是有效状态，不能被当成"未设置"过滤掉
      if (this._config[k] !== undefined && this._config[k] !== "") out[k] = this._config[k];
    });
    saveRuntime(this._lsKey || storageKey(this._rawConfig), out);
  }

  /* 解析布局：官方 panel 视图 / sections 紧凑 / 自定义全屏 */
  _resolveLayout() {
    const cfg = this._config;
    // 用户显式指定 compact 时永远尊重（哪怕在 panel 视图里）
    if (cfg.layout === "compact" || cfg.fullscreen === false) return LAYOUT.COMPACT;
    if (cfg.fullscreen === true || cfg.layout === "full" || cfg.layout === "panel" || cfg.fill === true) return LAYOUT.FULL;
    // 关键：hui-card 在 panel 视图里会直接给卡片元素赋 layout="panel"（官方 hui-map-card 也读这个信号）。
    // 这比爬 DOM 祖先可靠得多——隔壁 shadow root 里的 hui-panel-view 用 parentElement 根本爬不到。
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
        cur = root.host;          // 跨过 shadow 边界，继续从宿主往上爬
        el = cur.parentElement;
        // 宿主本身也算一层（它就是 hui-panel-view / hui-grid-section 之类）
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
      // sections 视图：卡片被困在固定高度的 grid 格子里，铺满没意义 → compact（想全屏请开 fill / 点全屏按钮）
      if (/^(hui-grid-section|hui-sections-view)$/.test(tag)) return LAYOUT.COMPACT;
      // 卡片直接挂在视图容器上 → 官方 panel 布局
      if (/^(hui-panel-view|hui-masonry-view|hui-grid-view)$/.test(tag)) {
        return r.height > viewH * 0.7 ? LAYOUT.FULL : LAYOUT.COMPACT;
      }
      // 过渡容器（hass-tabs-subpage / hui-view 等）：高度接近视口且明显高于我 → 可铺满
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
    // 父容器高度不足以容纳整屏 → 说明它不会给我铺满的空间
    return r.height < vh * 0.85;
  }

  _wantBleed() {
    // 用户手动点过全屏按钮：以手动选择为准（哪怕当前布局判定为紧凑）
    if (this._bleedUser === true) return true;
    if (this._layout !== LAYOUT.FULL) return false;
    if (this._bleedUser === false) return false;
    // 显式 fill:true → 无条件铺满
    if (this._config?.fill === true) return true;
    return this._parentTooSmall();
  }

  _applyBleed(on, initial) {
    const has = this.classList.contains("cmc-bleed");
    if (on && !has) {
      // 清掉 compact 模式下写死的内联高度，否则会压过 :host(.cmc-bleed)
      this.style.height = "";
      this.classList.add("cmc-bleed");
    } else if (!on && has) {
      this.classList.remove("cmc-bleed");
      this.style.height = this._layout === LAYOUT.FULL ? "" : `${this._config?.height || 360}px`;
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
      // 尺寸变了，瓦片要重铺；等浏览器完成布局再算
      requestAnimationFrame(() => this._engine?.render());
    }
    this._isBleed = on;
  }

  /* 外部尺寸变化后自愈：该全屏却没铺满就自动升级成 fixed */
  _syncBleed() {
    if (this._layout !== LAYOUT.FULL) return;
    if (this._bleedUser !== undefined) return;
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
    // 重建会把引擎换掉：先记住旧视野，切底图/主题时不该把人踢回北京
    const prevView = this._engine
      ? {
          c: { ...this._engine.center },
          z: this._engine.zoom,
          moved: this._engine._userMoved,
          sel: this._engine._selectedEntity || null, // 重建后要恢复选中光环，否则详情页"选中却无光环"
        }
      : null;
    const cfg = this._config;
    const base = BASEMAPS[cfg.basemap] || BASEMAPS.amap;
    const layout = this._layout = this._resolveLayout();
    const isFull = layout === LAYOUT.FULL;
    // 官方在 panel 布局把缩放控件放右上、其它情况左上
    const zoomSide = isFull ? "right" : "left";
    // fill：sections 视图里也铺满（bleed 会接管实际铺满）
    const fill = cfg.fill === true;
    const ar = this._parseAspect(cfg.aspect_ratio);
    const h = isFull ? "100%" : ar ? "auto" : `${cfg.height || 360}px`;
    // 内联压过外部对宿主元素的 height:100% 拉伸（panel 视图会这样干）
    if (typeof this.style !== "undefined") this.style.height = isFull ? "" : h;
    this._isFull = isFull;
    this._zoomSide = zoomSide;

    const titleHtml = cfg.title
      ? `<div class="cmc-title">${escapeHtml(cfg.title)}</div>` : "";
    const overlayOpen = this._panelOpen === true;
    // 手机（<=600px）走官方同款 ha-snap-bottom-sheet；宽屏保持左侧浮层
    const phone = this._isPhone();
    this._phone = phone;
    // 组件缺失时退回旧抽屉，避免整块内容失去定位掉到卡片底部
    let sheetOk;
    try { sheetOk = phone && !!window.customElements.get("ha-snap-bottom-sheet"); } catch { sheetOk = false; }
    this._sheetOk = sheetOk;
    // 该组件属于按需加载块：本卡片单独渲染时往往还没注册。
    // 先退回旧抽屉，等它被前端加载（如打开官方地图）后再自动升级成官方三档抽屉。
    if (phone && !sheetOk && !this._sheetWait) {
      this._sheetWait = true;
      try {
        window.customElements.whenDefined("ha-snap-bottom-sheet")
          .then(() => {
            this._sheetWait = false;
            if (this.isConnected && this._isPhone()) { this._render(); this._update(); }
          })
          .catch(() => { this._sheetWait = false; });
      } catch { this._sheetWait = false; }
    }
    // RTL：HA 的 dir 在文档根上，shadow 里用计算样式判断，给卡片加类做镜像
    let rtl;
    try { rtl = getComputedStyle(this).direction === "rtl"; } catch { rtl = false; }
    this._rtl = rtl;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block;
          height:${h};
          ${(isFull || fill) ? "min-height:0;" : ""}
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
        .cmc-card.is-aspect { height:auto; }
        .cmc-card {
          width:100%; height:100%; position:relative; overflow:hidden;
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
        /* ---- 控件：官方 ha-icon-button 外形（48 圆、无底色、白底胶囊分组） ---- */
        .cmc-ctrl {
          position:absolute; z-index:14; display:flex; flex-direction:column; gap:6px;
          top:${cfg.title ? 56 : 8}px;
          ${zoomSide}:8px;
        }
        /* 官方：缩放组在最上，其余图标依次向下 */
        .cmc-ctrl > .cmc-ctrl-group + button { margin-top:2px; }
        .cmc-ctrl-group {
          display:flex; flex-direction:column;
          background:var(--cmc-surface); border-radius:24px;
          box-shadow:var(--cmc-shadow); overflow:hidden;
        }
        .cmc-ctrl-group > button + button { border-top:1px solid var(--cmc-divider); border-radius:0; }
        .cmc-ctrl button {
          width:40px; height:40px; border:none; background:var(--cmc-surface);
          color:var(--cmc-text); cursor:pointer; display:flex; align-items:center;
          justify-content:center; padding:0; border-radius:20px; box-shadow:var(--cmc-shadow);
          transition:background .15s;
          -webkit-tap-highlight-color:transparent;
        }
        .cmc-ctrl-group button { box-shadow:none; border-radius:0; }
        .cmc-ctrl button:hover { background:var(--cmc-fill); }
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
          background:var(--cmc-surface); color:var(--cmc-text);
          box-shadow:var(--cmc-shadow); cursor:pointer;
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
              ${isFull ? `<button class="cmc-panel-close" data-back aria-label="收起面板">
                <svg viewBox="0 0 24 24"><path d="${ICONS.chevronLeft}"/></svg>
              </button>` : ""}
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

    // 先决定"要不要真正铺满"再建引擎：容器的最终尺寸直接影响首帧视野
    this._applyBleed(this._wantBleed(), true);

    const mapEl = this.shadowRoot.querySelector(".cmc-map");
    this._engine = new CnTileEngine(mapEl);
    this._engine.onTrackHover = (info) => this._showTrackTip(info);
    this._engine.removeTileSets();
    base.layers.forEach((l, i) => {
      this._engine.addTileSet({
        url: (x, y, z) => l.template(x, y, z, cfg.tianditu_key),
        maxZoom: base.maxZoom,
        opacity: l.opacity ?? 1,
        zIndex: i + 1,
        nofilter: !!base.noFilter,
      });
    });
    this._engine.attribution.textContent = base.attribution;
    this._engine.scaleEl = this.shadowRoot.querySelector(".cmc-scale");
    this._engine.addEventListener("marker-click", (e) => {
      const id = e.detail.entityId;
      const ent = this._hass?.states?.[id];
      if (!ent || !this._hass) return;
      // 官方交互：第一次点击=聚焦飞行+选中（打开最近活动详情），第二次点同一标记才打开 more-info
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
    // 点空白处/Esc 取消选中时：详情页退回列表（官方行为），同时把地址栏里的 entity_id 清掉
    // 家的图标/半径圈拖动：拖动中只改内存并回填设置，松手才落盘（避免每帧写 localStorage）
    this._engine.addEventListener("marker-drag", (e) => this._onHomeDrag(e.detail));
    this._engine.addEventListener("circle-radius", (e) => this._onHomeRadius(e.detail));
    this._engine.addEventListener("selection-cleared", () => {
      this._writeSelection(null);
      if (this._panelView === "detail") {
        this._setPanelView?.("list");
        this._renderList();
      }
    });
    // 卡片里的按钮默认是 type=submit 语义，放在宿主表单/链接里会触发跳转
    this.shadowRoot.querySelectorAll("button").forEach((btn) => btn.setAttribute("type", "button"));

    /* ---- 概览面板（人 / 设备 / 区域）与设置面板共用一个容器 ---- */
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
      // 折叠后没有可点的东西会再也打不开（桌面 dock-auto 整个滑出屏幕），用悬浮按钮兜底
      this.shadowRoot.querySelector("[data-panel-btn]")?.classList.toggle("hide", open);
      if (open) showView(this._panelView || "list");
      // 手机：位置与拖拽交给官方 ha-snap-bottom-sheet
      const sheet = this.shadowRoot.querySelector("[data-sheet]");
      if (sheet) {
        try { sheet.snapTo(open ? "half" : "collapsed"); } catch { /* 组件未升级时忽略 */ }
      }
    };
    this._setPanelOpen = setOpen;
    this._setPanelView = showView;

    // 手机底部抽屉：peek 高度按真实页头量，抽屉高度变化再喂给 fitPadding（实测尺寸驱动）
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
        // 抽屉拖拽过程中会高频触发；只做轻量重绘，等拖拽停了再重新 fit 一次
        this._engine?.render();
        if (this._fitRefitTimer) clearTimeout(this._fitRefitTimer);
        this._fitRefitTimer = setTimeout(() => {
          this._fitRefitTimer = null;
          // 用户刚点过实体（flyTo 已飞过去）就不要自动 refit 把视角抢走
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

    // 默认：全屏布局展开列表，紧凑布局收起
    setOpen(overlayOpen || (this._isFull && this._panelView !== "settings" && this._panelUserClosed !== true));

    panel.querySelectorAll("[data-tab]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this._tab = b.dataset.tab;
        this._renderList();
      });
    });
    // 键盘无障碍：方向键在可见 Tab 间移动（RTL 下左右语义反转），Home/End 到两端
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
    // 折叠后的悬浮弹出按钮（桌面全屏面板折叠后会整体滑出屏幕）
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
    // 详情页返回列表
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
    // 详情页「导航」：与官方 hui-map-overview 一致，手机走原生地图应用，桌面走网页地图
    panel.querySelector("[data-det-nav]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._openDirections();
    });
    // 详情页「实体设置」：官方仅管理员可见，打开 more-info 的设置页
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
      const evt = el.type === "checkbox" || el.tagName === "SELECT" || el.dataset.lazy !== undefined ? "change" : "input";
      el.addEventListener(evt, () => this._onDrawerChange(el));
    });
    // 恢复为 YAML 配置（清掉本浏览器存的设置）
    this.shadowRoot.querySelector("[data-reset]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this._resetting) return;
      this._resetting = true;
      try {
        const raw = { ...this._rawConfig };
        delete raw.persist;
        try { window.localStorage.removeItem(this._lsKey || storageKey(raw)); } catch { /* 忽略 */ }
        this.setConfig(raw);
      } finally {
        this._resetting = false;
      }
      this._didFit = false;
      if (this._hass) this._update();
    });

    // 聚合快捷开关
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

    // 路况快捷开关
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
      // 路况是叠加层，不必重建整个卡片
      const traffic = BASEMAPS.traffic;
      const want = next && String(this._config.basemap).startsWith("amap");
      this._engine.setOverlay(
        "traffic",
        want ? { maxZoom: traffic.maxZoom, layers: traffic.layers.map((l) => ({ template: l.template, opacity: l.opacity })) } : null
      );
      this._syncDrawer();
      this._persistConfig(this._config);
    });

    // 重置焦点：回到「家」的位置与默认缩放（区别于「显示全部」的全实体适配）
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
      // 浏览器原生 fullscreen 在 HA App 的 WebView 里基本无效（只对 <video> 生效），
      // 所以这里用 CSS 的 position:fixed 铺满视口 —— 任何视图类型都能用。
      this._toggleBleed();
    });
    // 全屏时点地图空白处不收起面板（官方行为），只在面板外点按才收起
    document.addEventListener("fullscreenchange", this._onFsChange = () => {
      if (document.fullscreenElement === this) this._engine?.render();
    });

    // 实时路况：仅高德底图支持（路况瓦片与底图同属 GCJ-02 坐标系）
    const traffic = BASEMAPS.traffic;
    const wantTraffic = !!cfg.show_traffic && String(cfg.basemap).startsWith("amap");
    this._engine.setOverlay(
      "traffic",
      wantTraffic
        ? { maxZoom: traffic.maxZoom, layers: traffic.layers.map((l) => ({ template: l.template, opacity: l.opacity })) }
        : null
    );

    this._basemapShift = base.needsShift;
    // 主题：重建 DOM 后要把暗色类补回来（_render 会换掉整个 shadowRoot）
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
    if (this._hass) this._update(); else this._engine.render();
    // 必须补一帧：_didFit 已为 true 时 _update 走不到 render()，
    // 换底图后地图会是一片空白（v1.0.3 修）
    this._engine.render();
    this._applyAspect();
    this._applyConditions();   // 换配置后立即评估（不满足时连渲染都省掉）
    this._renderList();
  }

  _collectEntities() {
    const hass = this._hass;
    if (!hass) return [];
    const cfg = this._config;
    // 去重：person 的 attributes.source 指向它的位置来源 device_tracker，
    // 两者坐标完全重合，自动模式下只画 person（官方 hui-map-card 的 _getAllEntities 同样处理）。
    // 用户显式写在 entities: 里的保持原样，不替他做决定。
    const personSources = new Set();
    if (cfg.dedupe_trackers !== false) {
      Object.values(hass.states).forEach((st) => {
        if (st.entity_id.startsWith("person.") && st.attributes?.source) {
          personSources.add(st.attributes.source);
        }
      });
    }
    let ids = [];
    if (cfg.entities?.length) {
      // entities 支持字符串与对象两种写法（对象：{entity, color, name, label_mode, attribute, unit}）。
      // 之前直接 [...cfg.entities] 原样拷贝，对象条目会被 hass.states[id] 查成 undefined 滤掉——
      // 只写 entities 不开 show_all 时对象实体根本不上地图（v1.1.3 顺带修）
      ids = cfg.entities.map((e) => (typeof e === "object" ? e.entity : e)).filter(Boolean);
      // 对象条目的 source 写法：{source: "nmap"} 纳入该来源的全部 geo_location 实体（v1.1.5）
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
    if (this._preview) return; // 预览态不订阅轨迹，省一次 WS 请求
    const cfg = this._config;
    const hours = Number(cfg.hours_to_show) || 0;
    if (hours <= 0) {
      if (this._trackUnsub) { this._trackUnsub(); this._trackUnsub = null; }
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
    if (this._trackUnsub) { this._trackUnsub(); this._trackUnsub = null; }

    const conn = this._hass?.connection;
    if (!conn || !conn.subscribeMessage) return;

    const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    this._trackPoints = {};
    Promise.resolve(
      conn.subscribeMessage(
        (msg) => {
          if (!msg?.states) return;
          Object.entries(msg.states).forEach(([id, arr]) => {
            const pts = (arr || [])
              .map((st) => {
                const lat = st.a?.latitude, lng = st.a?.longitude;
                if (typeof lat !== "number" || typeof lng !== "number") return null;
                // history/stream 的时间字段：minimal_response 下是 lc(秒)，否则可能是 ISO
                const raw = st.lc ?? st.last_changed ?? st.lu ?? st.last_updated ?? null;
                let t = null;
                if (typeof raw === "number") t = raw < 1e12 ? raw * 1000 : raw;
                else if (typeof raw === "string") { const ms = Date.parse(raw); t = Number.isFinite(ms) ? ms : null; }
                return { lat, lng, t };
              })
              .filter(Boolean);
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
          no_attributes: false,
        }
      )
    )
      .then((unsub) => { this._trackUnsub = unsub; })
      .catch(() => { this._trackUnsub = null; });
  }

  _paintTracks() {
    const cfg = this._config;
    const shift = this._basemapShift;
    const paths = [];
    Object.entries(this._trackPoints).forEach(([id, pts]) => {
      if (!pts || pts.length < 2) return;
      const color =
        this._entityConf(id)?.color ||
        this._hass?.states?.[id]?.attributes?.color ||
        "#03a9f4";
      paths.push({
        entityId: id,
        color,
        width: Number(cfg.track_width) || 3,
        opacity: cfg.track_opacity ?? 0.85,
        points: pts.map((p) => {
          if (!shift) return p;
          const [gl, gn] = GCJ.wgs2gcj(p.lat, p.lng);
          return { lat: gl, lng: gn, t: p.t };
        }),
      });
    });
    this._engine.setPaths(paths);
  }

  /* 轨迹点悬停：显示该点的 HH:MM 与相对时间（官方轨迹 tooltip 语义） */
  _showTrackTip(info) {
    const tip = this.shadowRoot?.querySelector(".cmc-tip");
    if (!tip) return;
    if (!info || !info.t) { tip.hidden = true; return; }
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
      // 默认开启的开关：值缺省时按 true 显示
      if (el.type === "checkbox") el.checked = c[k] === undefined ? ["show_cluster", "show_labels", "show_status", "show_accuracy", "show_zone_radius", "show_zones", "show_all", "respect_hidden", "show_scale"].includes(k) : !!c[k];
      else if (k === "hours_to_show") el.value = String(Number(c[k]) || 0);
      else if (k === "theme_mode") el.value = c[k] || "auto";
      else if (k === "label_mode") el.value = c[k] || "name";
      else el.value = c[k] === undefined ? "" : c[k];
    });
    const bm = c.basemap || "amap";
    d.querySelectorAll("[data-d-row]").forEach((el) => {
      el.style.display = el.dataset.dRow.split(" ").includes(bm) ? "" : "none";
    });
    // 家的坐标/半径留空时，用 HA zone.home 的当前值做占位提示（不写进配置）
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
    if (!hass) { box.innerHTML = ""; if (cnt) cnt.textContent = ""; return; }
    const hidden = new Set(cfg.hidden_entities || []);
    const explicit = (cfg.entities || []).map((e) => (typeof e === "object" ? e.entity : e)).filter(Boolean);
    const showAll = cfg.show_all !== false;
    const nameOf = (st) => st.attributes?.friendly_name || st.entity_id;
    const groups = [["person.", "人员"], ["device_tracker.", "设备"], ["zone.", "区域"]];
    let html = "", total = 0;
    groups.forEach(([pre, label]) => {
      const rows = Object.values(hass.states)
        .filter((st) => st.entity_id.startsWith(pre) && st.attributes?.latitude != null)
        .sort((a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)), "zh"));
      if (!rows.length) return;
      total += rows.length;
      html += `<div class="cmc-ent-group">${label}（${rows.length}）</div>`;
      rows.forEach((st) => {
        const id = st.entity_id;
        const on = id.startsWith("zone.")
          ? cfg.show_zones !== false && !hidden.has(id)
          : !hidden.has(id) && (showAll || explicit.includes(id));
        html += `<label class="cmc-ent"><input type="checkbox" data-ent="${escapeAttr(id)}"${on ? " checked" : ""}>`
          + `<span class="cmc-ent-n">${escapeHtml(nameOf(st))}</span>`
          + `<span class="cmc-ent-id">${escapeHtml(id)}</span></label>`;
      });
    });
    box.innerHTML = html || '<div class="cmc-empty">没有可定位实体</div>';
    if (cnt) cnt.textContent = total ? `共 ${total} 个` : "";
  }

  /* 勾选/取消一个实体：写 entities（自定义模式）或 hidden_entities（全部模式） */
  _toggleEntity(id, on) {
    const cfg = { ...this._config };
    const hidden = new Set(cfg.hidden_entities || []);
    const eid = (e) => (typeof e === "object" ? e.entity : e);
    if (id.startsWith("zone.")) {
      if (on) { hidden.delete(id); cfg.show_zones = true; }
      else hidden.add(id);
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
    } else if (on) hidden.delete(id); else hidden.add(id);
    cfg.hidden_entities = [...hidden];
    this._config = cfg;
    this._saveRuntime();
    this._persistConfig(cfg);
    Promise.resolve().then(() => { this._update(); this._renderEntityPicker(); });
  }

  /* 家庭地址解析：支持 “纬度,经度” 直填，或高德 Web 服务 Key 地理编码 */
  async _geocodeHome() {
    const cfg = { ...this._config };
    const hint = this.shadowRoot?.querySelector("[data-geo-hint]");
    const addr = String(cfg.home_address || "").trim();
    const setHint = (t) => { if (hint) hint.textContent = t; };
    if (!addr) { setHint("先填地址，或直接填“纬度,经度”"); return; }
    const m = addr.match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
    let lat, lng;
    if (m) {
      lat = Number(m[1]); lng = Number(m[2]);
      if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
    } else {
      const key = String(cfg.amap_key || "").trim();
      if (!key) { setHint("地址解析需要高德 Web 服务 Key；也可直接填“纬度,经度”"); return; }
      try {
        const r = await fetch(`https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(key)}&address=${encodeURIComponent(addr)}`);
        const j = await r.json();
        const loc = j?.geocodes?.[0]?.location;
        if (!loc) { setHint(`解析失败：${j?.info || "无结果"}`); return; }
        [lng, lat] = String(loc).split(",").map(Number);
      } catch {
        setHint("地址服务不可达，请直接填经纬度");
        return;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setHint("坐标不合法"); return;
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

  /* 同步到 HA 核心区域（设置 → 区域与地点 → 我的家）。
     新版 HA（2024.10+）已经没有 zone.edit 服务，失败时只保留本卡覆盖并提示用户手动改。 */
  async _syncHomeToZone(patch, done) {
    this._saveRuntime();
    this._persistConfig(this._config);
    if (!this._zoneEditSupported) {
      // HA 新版本没有 zone 编辑服务：只在本卡生效，不弹错误
      this._setGeoHint(`${done}（已保存到本卡片；到 设置 → 区域与地点 → 我的家 可手动同步）`);
      return;
    }
    this._setGeoHint(done);
    try {
      await this._hass.callService("zone", "edit", { entity_id: "zone.home", ...patch });
      // 同步成功：清掉本卡覆盖，让卡片直接用 HA zone.home 的最新值
      const next = { ...this._config };
      delete next.home_lat; delete next.home_lng; delete next.home_radius;
      this._config = next;
      this._saveRuntime();
      this._persistConfig(next);
      this._setGeoHint(`${done}（已同步到家区域）`);
      Promise.resolve().then(() => this._update());
    } catch (err) {
      console.warn("[ha-cn-map-card] zone.edit failed:", err);
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
    lat = Number(lat.toFixed(6)); lng = Number(lng.toFixed(6));
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
      if (!Number.isFinite(r) || r < 20 || r > 100000) return;
      this._config = { ...this._config, home_radius: r };
      this._syncHomeFields();
    }
    if (d.phase === "end") {
      this._engine._userMoved = true;
      const r = Math.round(d.radius);
      if (!Number.isFinite(r) || r < 20 || r > 100000) return;
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
      // 关闭“全部可定位”时，把当前可见实体固化成自定义清单，避免瞬间空图
      const keep = (cfg.entities || []).filter((e) => typeof e === "object");
      const objs = new Map(keep.map((o) => [o.entity, o]));
      cfg.entities = this._collectEntities().map((st) => objs.get(st.entity_id) || st.entity_id);
    }
    if (el.type === "checkbox") {
      cfg[k] = v;               // false 也是有效状态，不能当"未设置"删掉
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
    // 注意：_render() 会把 shadow DOM 整个换掉，而此刻事件还在往当前元素冒泡，
    // 直接重建会让监听器执行到一半节点就没了。放到微任务里再重建。
    // theme_mode 也要重建：暗色类是挂在 .cmc-card 上的，_update 不会改它
    const rebuild = ["basemap", "theme_mode", "tianditu_key", "show_traffic", "hours_to_show", "height"].includes(k);
    if (rebuild) {
      Promise.resolve().then(() => {
        this._render();
        // 重建后把面板恢复到"设置"页并保持展开，用户视角不跳
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
        composed: true,
      })
    );
  }

  disconnectedCallback() {
    if (this._trackUnsub) { this._trackUnsub(); this._trackUnsub = null; }
    if (this._onFsChange) document.removeEventListener("fullscreenchange", this._onFsChange);
    if (this._onKeyBleed) this.removeEventListener("keydown", this._onKeyBleed);
    if (this._onDocKey) { document.removeEventListener("keydown", this._onDocKey); this._onDocKey = null; }
    if (this._onPop) { window.removeEventListener("popstate", this._onPop); this._onPop = null; }
    if (this._onLoc) { window.removeEventListener("location-changed", this._onLoc); this._onLoc = null; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._mq && this._onMq) { this._mq.removeEventListener?.("change", this._onMq); this._mq = null; this._onMq = null; }
  }

  connectedCallback() {
    // 地址栏变化时回填选中（官方 _syncSelection 同款监听）
    if (!this._onPop) {
      this._onPop = () => this._syncUrlSelection();
      window.addEventListener("popstate", this._onPop);
    }
    if (!this._onLoc) {
      this._onLoc = () => this._syncUrlSelection();
      window.addEventListener("location-changed", this._onLoc);
    }
    // 全局 Esc：详情页退回列表（点标记后焦点不在引擎容器上，引擎那层键盘处理接不到）
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
    // panel 视图撑满容器后尺寸会变，重新算布局 + 重绘瓦片
    if (typeof ResizeObserver === "function" && !this._ro) {
      this._ro = new ResizeObserver(() => {
        const layoutNow = this._resolveLayout();
        if (layoutNow !== this._layout) {
          this._syncLayout();
        } else {
          // 尺寸变了：先看要不要自愈成全屏，再重铺瓦片
          this._syncBleed();
          this._engine?.render();
        }
      });
      this._ro.observe(this);
    }
    // 手机/宽屏切换：抽屉形态要换（ha-snap-bottom-sheet ↔ 左侧浮层），整卡重建一次
    if (typeof window.matchMedia === "function" && !this._mq) {
      this._mq = window.matchMedia("(max-width: 600px)");
      this._onMq = () => {
        if (this._mq.matches === this._phone) return;
        this._render();
        if (this._hass) this._update();
      };
      this._mq.addEventListener?.("change", this._onMq);
    }
    // 首帧后再判一次：刚挂上时祖先尺寸可能还没稳定
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
    if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
      url = `https://maps.apple.com/?daddr=${point}`;
    } else if (/Android/i.test(ua)) {
      url = `geo:${point}?q=${point}`;
    } else {
      // 桌面：OSM 官方链接在国内不一定可达，优先高德（坐标按 WGS84 传入，由高德自行转换）
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
      if (d > 0.5) nearest = Math.min(nearest, d); // 跳过自己（同一坐标）
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
    } catch (_) { /* 某些内嵌 WebView 没有 URLSearchParams */ }
    const hash = String(window.location.hash || "").replace(/^#/, "");
    if (!raw && hash) {
      if (hash.includes("=")) {
        try {
          const hp = new URLSearchParams(hash);
          raw = hp.get("entity_id") || hp.get("entity") || "";
        } catch (_) {}
      } else if (/^(person|device_tracker|zone|geo_location)\./.test(hash)) {
        raw = hash;
      }
    }
    if (!raw) return;
    let id = raw;
    try { id = decodeURIComponent(raw); } catch (_) {}
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
    } catch (_) { /* 少数内嵌 WebView 没有 history API，忽略即可 */ }
  }

  /* 地址栏变化（浏览器后退/前进、别的组件改参数）时回填选中态 */
  _syncUrlSelection() {
    if (!this._isFull || !this._hass) return;
    let raw = "";
    try { raw = new URLSearchParams(window.location.search).get("entity_id") || ""; } catch (_) {}
    let id = raw;
    try { id = decodeURIComponent(raw); } catch (_) {}
    if (!id || !/^(person|device_tracker|zone|geo_location)\./.test(id)) {
      // 参数被清掉：和官方一样取消选中、详情退回列表
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
    // 标记是按底图坐标系画的（高德要 GCJ-02 纠偏），聚焦必须用同一套坐标，
    // 否则飞过去会差 300~500m（v1.0.1 修）
    if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
    this._engine.setSelected(entityId);
    this._writeSelection(entityId);
    // 选中即打开详情（最近活动），对齐官方 hui-map-overview 的聚焦语义
    this._showDetail(entityId);
    this._userSelected = true; // 阻止抽屉展开后的自动 refit 把视角抢走
    // 聚焦人员时直接缩到街道级（z=16），不要按最近标记距离算——
    // 否则一个人员在家、另一个在外地，最近标记相距数百公里，算法会把 zoom 拉回全国视图
    const z = Math.max(Number(zoom ?? 0) || 16, 16);
    let offX = 0, offY = 0; // 像素偏移：面板 dock 在哪侧就把中心往对侧挪
    if (this._isFull && this._panelOpen) {
      const dockBottom = window.innerWidth <= 600;
      const pad = this._fitPadding();
      // 屏幕 y 向下、世界 y 也向下：想让目标出现在中心"上方"（避开底部抽屉），
      // 中心就得往南挪（lat 减）；想让目标出现在中心"右侧"（避开左侧浮层），
      // 中心就得往西挪（lng 减）。符号错了目标会被推到面板底下（v1.0.1 修）
      if (dockBottom) offY = -pad * 0.35;
      else offX = -pad * 0.35;
    }
    // 像素偏移 → 经纬度偏移（当前 zoom 下）
    const mPerLng = 360 / (2 ** z * 256);
    const mPerLat = mPerLng / Math.cos((lat * Math.PI) / 180);
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
    // 同一实体只拉一次历史；切到别的实体重新拉
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
    // 导航：官方只在实体有坐标时显示；设置：官方仅管理员可见
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
    const req = (this._actReq = (this._actReq || 0) + 1);
    const bodyEl = this.shadowRoot.querySelector("[data-activity]");
    if (!bodyEl) return;
    this._actFailed = false;
    this._actEntries = null;
    this._actExpanded = false;
    bodyEl.innerHTML = `<div class="cmc-act-empty">加载中…</div>`;
    const isZone = entityId.startsWith("zone.");
    // zone 详情 = 全部人员进出该区域；实体详情 = 自己的状态变化
    const ids = isZone ? this._listEntries().people.map((s) => s.entity_id) : [entityId];
    if (!ids.length) {
      this._actEntries = [];
      this._renderActivity();
      return;
    }
    let history;
    try {
      // 与官方 fetchDateWS 同一条 WebSocket 消息
      history = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        end_time: new Date().toISOString(),
        entity_ids: ids,
        minimal_response: false,
        no_attributes: false,
      });
    } catch {
      history = null;
    }
    if (req !== this._actReq) return; // 加载期间用户切到了别的实体
    this._actFailed = history === null;
    this._actEntries = this._computeActivity(entityId, history, isZone, ids);
    this._renderActivity();
  }

  _computeActivity(entityId, history, isZone, personIds) {
    const NO_LOC = ["unavailable", "unknown"];
    const since = Date.now() - 24 * 3600 * 1000;
    const out = [];
    if (isZone) {
      for (const pid of personIds) {
        const person = this._hass?.states?.[pid];
        let wasIn;
        for (const e of history?.[pid] || []) {
          if (NO_LOC.includes(e.s)) continue;
          const inZone = Array.isArray(e.a?.in_zones) ? e.a.in_zones.includes(entityId) : false;
          // 窗口开始时的第一帧不算事件；只有进/出的变化才算
          const isEvent = wasIn === undefined ? inZone : inZone !== wasIn;
          if (isEvent && e.lu * 1000 >= since) {
            out.push({ entityId: pid, name: person?.attributes?.friendly_name || pid, picture: person?.attributes?.entity_picture, when: e.lu * 1000, arrived: inZone });
          }
          wasIn = inZone;
        }
      }
      out.sort((a, b) => b.when - a.when);
    } else {
      let prev;
      for (const e of history?.[entityId] || []) {
        if (NO_LOC.includes(e.s)) continue;
        if (e.s === prev) continue; // 只留状态变化
        prev = e.s;
        if (e.lu * 1000 < since) continue;
        out.push({ entityId, state: e.s, when: e.lu * 1000 });
      }
      out.reverse(); // 最新在前
    }
    return out.slice(0, HaCnMapCard.ACTIVITY_MAX);
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
      if (en.arrived !== undefined) {
        // 区域详情：谁进入 / 离开
        hl = escapeHtml(en.name);
        prefix = en.arrived ? "进入" : "离开";
      } else {
        hl = escapeHtml(this._activityHeadline(en.state));
      }
      const ent = this._hass?.states?.[en.entityId];
      const nm = en.name || ent?.attributes?.friendly_name || en.entityId;
      const pic = en.picture || ent?.attributes?.entity_picture;
      const av = pic
        ? `<img src="${escapeAttr(pic)}" referrerpolicy="no-referrer" alt="">`
        : this._initial(nm);
      return `<div class="cmc-act-row">
        <span class="cmc-act-av" data-i="${escapeAttr(this._initial(nm))}">${av}</span>
        <span class="cmc-act-tx">
          <span class="cmc-act-hl">${hl}</span>
          <span class="cmc-act-when">${prefix ? `${prefix} · ` : ""}${hhmm(en.when)} · ${escapeHtml(this._relTime(en.when) || "刚刚")}</span>
        </span>
      </div>`;
    });
    bodyEl.innerHTML = `<div class="cmc-act-body-inner">${rows.join("")}</div>${
      list.length > shown.length
        ? `<button class="cmc-act-more" data-act-more type="button">显示全部 ${list.length} 条</button>`
        : ""
    }`;
    bodyEl.querySelector("[data-act-more]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._actExpanded = true;
      this._renderActivity();
    });
    // 头像加载失败（离线/失效的 entity_picture）→ 回落到首字母
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
      const val = c.attribute != null
        ? String(st.attributes?.[c.attribute])
        : String(st.state);
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
    return (this._config?.entities || []).find((e) =>
      typeof e !== "object" ? e === entityId
        : e.entity ? e.entity === entityId
        : e.source ? entityId.startsWith("geo_location.") && st?.attributes?.source === e.source
        : false
    );
  }

  _update() {
    if (this._applyConditions()) return;   // conditions 不满足：整卡隐藏，布局不留空白
    const hass = this._hass, cfg = this._config;
    // 比例尺开关（官方字段 scale_ruler；默认保留常显）
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
      // 按域给默认图标，避免实体自带的地图类 icon（如 map-marker-radius）显示成放大镜
      const domain = s.entity_id.split(".")[0];
      const domainIcon =
        domain === "person" ? "mdi:account"
        : domain === "device_tracker" ? "mdi:cellphone-marker"
        : "mdi:map-marker";
      const icon = s.attributes.icon || domainIcon;
      // 每实体配置：{ entity, color, name, label_mode, attribute, unit, focus }（source 写法见 _entityConf）
      const conf = this._entityConf(s.entity_id);
      const name = conf?.name || friendly_name || s.entity_id;
      const color =
        conf?.color ||
        s.attributes.color ||
        (domain === "person" ? "#58a6f0" : "#8bc34a");
      markers.push({
        lat, lng, entityId: s.entity_id,
        picture: pic || "",
        color,
        short: name,
        clusterable: true,
        icon,
        label: cfg.show_labels === false ? "" : this._markerLabel(s, conf, cfg, name),
        sub: cfg.show_status === false ? "" : this._markerSub(s, states),
        offline: OFFLINE_STATES.has(String(s.state).toLowerCase()),
      });
      pts.push({ lat, lng }); // fitBounds 必须用底图坐标系（已纠偏），否则自动适配中心偏 500m
    });

    const zoneCircles = [];
    if (cfg.show_zones) {
      Object.values(hass.states).filter((s) => s.entity_id.startsWith("zone.")).forEach((z) => {
        const { latitude, longitude, friendly_name, passive, radius } = z.attributes;
        if (latitude == null || passive) return;
        if ((cfg.hidden_entities || []).includes(z.entity_id)) return;
        let lat = latitude, lng = longitude, radiusAttr = radius;
        // 家：用户在设置里自定义了坐标/半径就覆盖 HA zone.home 的属性（只影响卡片，不改 HA 配置）
        if (z.entity_id === "zone.home") {
          if (cfg.home_lat != null && cfg.home_lat !== "" && cfg.home_lng != null && cfg.home_lng !== "") {
            lat = Number(cfg.home_lat); lng = Number(cfg.home_lng);
          }
          if (cfg.home_radius != null && cfg.home_radius !== "" && Number(cfg.home_radius) > 0) {
            radiusAttr = Number(cfg.home_radius);
          }
        }
        if (this._basemapShift) [lat, lng] = GCJ.wgs2gcj(lat, lng);
        const name = friendly_name || z.entity_id;
        markers.push({
          lat, lng,
          entityId: z.entity_id,
          short: name,
          label: cfg.show_labels === false ? "" : name,
          clusterable: false,   // 家/区域不参与聚合，永远单独显示
          home: true,
          draggable: z.entity_id === "zone.home",   // 只能拖家（其他区域没有对应的覆盖配置）
          icon: z.attributes.icon || "mdi:home",
        });
        pts.push({ lat, lng });
        // 区域半径圈：radius 才是 zone 的核心属性（官方把 zone 画成带半径的圆）。
        // 旧版本只画小房子图标，半径信息完全丢失（v1.0.2 补）
        const r = Number(radiusAttr);
        if (cfg.show_zone_radius !== false && Number.isFinite(r) && r > 0) {
          zoneCircles.push({
            entityId: z.entity_id,
            lat, lng,
            radius: r,
            color: this._zoneColor(z),
            dashed: true,
            fillOpacity: 0.12,
            strokeOpacity: 0.55,
            strokeWidth: 2,
            handle: z.entity_id === "zone.home",   // 家半径圈带一个可拖动的小手柄
          });
          if (cfg.fit_zones) {
            // 半径圈的四极值点也纳入自动适配，否则大区域会被裁掉半圈
            const dLat = r / 111320;
            const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
            pts.push({ lat: lat + dLat, lng }, { lat: lat - dLat, lng });
            pts.push({ lat, lng: lng + dLng }, { lat, lng: lng - dLng });
          }
        }
      });
    }

    this._lastMarkers = markers; // 聚焦缩放要用显示坐标（已按底图纠偏）算最近标记
    this._engine.setMarkers(markers, { cluster: cfg.show_cluster !== false });
    this._syncTracks(states);
    // 圈层：区域半径圈在下、GPS 精度圈在上（都在轨迹层，标记之下）
    const circles = [...zoneCircles];
    if (cfg.show_accuracy !== false) {
      states.forEach((s) => {
        const acc = Number(s.attributes.gps_accuracy);
        const { latitude, longitude } = s.attributes;
        if (!Number.isFinite(acc) || acc <= 0 || latitude == null) return;
        if (s.entity_id.startsWith("zone.")) return;
        let clat = latitude, clng = longitude;
        if (this._basemapShift) [clat, clng] = GCJ.wgs2gcj(clat, clng);
        const color =
          this._entityConf(s.entity_id)?.color ||
          s.attributes.color ||
          (s.entity_id.split(".")[0] === "person" ? "#58a6f0" : "#8bc34a");
        circles.push({ entityId: s.entity_id, lat: clat, lng: clng, radius: acc, color });
      });
    }
    this._engine.setAccuracyCircles(circles);
    // 只在首次、且用户还没手动拖动/缩放时自动适配视野
    if (cfg.fit_entities && pts.length && !this._didFit && !this._engine._userMoved) {
      // 全屏时给概览面板留出空间，免得标记被面板盖住
      this._engine.fitBounds(pts, this._fitPadding());
      this._didFit = true;
    } else if (!this._didFit) {
      this._engine.render();
    }
    // URL 深链：链接里带 ?entity_id=… 时首次渲染后直接定位到该实体
    this._applyUrlSelection();
    // entities 对象里的 focus: true：首次渲染后把视野聚焦到该实体（URL 深链优先，v1.1.5）
    if (!this._urlApplied && !this._focusApplied) {
      const fe = (cfg.entities || []).find((e) => typeof e === "object" && e.focus && e.entity);
      if (fe && this._hass.states[fe.entity]?.attributes?.latitude != null) {
        this._focusApplied = true;
        this.focusEntity(fe.entity);
      }
    }
    // 详情页开着时保证标记仍处于选中态：setMarkers 重建 DOM 时若找不到会把它清空
    if (this._panelView === "detail" && this._detailEntity &&
        this._engine._selectedEntity !== this._detailEntity) {
      this._engine.setSelected(this._detailEntity);
    }
    // 列表里的状态文字（"离家 · 4 分钟前"）需要跟着 hass 刷新
    if (this._panelView === "detail") this._renderDetailHeader();
    else if (this._panelView !== "settings") this._renderList();
  }

  /* 自动适配时的内边距：全屏 + 面板展开时避开面板覆盖区
     （padding 会从可用宽高里扣两次，所以必须 clamp，否则会算出负数把缩放压到 3 级） */
  _isPhone() {
    try { return window.matchMedia("(max-width: 600px)").matches; } catch { return false; }
  }

  _fitPadding() {
    const w = this._engine?.container.clientWidth || 400;
    const h = this._engine?.container.clientHeight || 300;
    const base = Math.round(Math.min(w, h) * 0.08);
    // 手机上底部抽屉（peek / 半屏 / 全屏）会盖在地图下面，不管面板当前开没开，
    // 首次自动适配视野时都要给底部留一块，否则 home 标记被抽屉挡住
    if (this._phone) {
      const sheetH = Number(this._sheetH) || Number(this._sheetHalf) || 0;
      // 目标：把地理中心放到「可视地图区（屏幕高 - 抽屉高）的中点」，
      // 即 bottom-padding ≈ 抽屉高 + 可视区高/2 ≈ 抽屉高/2 + 屏高/2
      const pad = sheetH ? Math.round(sheetH * 0.95) : Math.round(h * 0.45);
      const bottom = Math.max(base, Math.min(pad, Math.floor(h * 0.75)));
      return { top: base, right: base, bottom, left: base };
    }
    if (!this._isFull || !this._panelOpen) return base;
    const pad = Math.round(w * 0.28) + 12;    // 左侧浮层
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
    // 人员：按 HA 里全部 person 实体列出，不看它当前有没有坐标。
    // 否则某人定位掉线（person 状态没有 latitude）时「人员」Tab 会整组消失，像被删掉一样。
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
    // 区域：该区域里有人时计数才有意义
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
      // 官方规范要求用 hass.formatEntityState 而不是原始状态（能拿到"在家"/"45 km/h"这类本地化文本）
      let v = raw, formatted = false;
      try {
        if (typeof this._hass?.formatEntityState === "function") {
          v = this._hass.formatEntityState(st);
          formatted = v !== raw;
        }
      } catch (_) {}
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
    // 区域：person 的 state 就是 zone 的 object_id
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
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
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
    if (!active || btns.length <= 1) { pill.style.display = "none"; return; }
    pill.style.display = "";
    tabsEl.style.setProperty("--n", String(btns.length));
    const left = active.offsetLeft, width = active.offsetWidth;
    if (width) { pill.style.left = `${left}px`; pill.style.width = `${width}px`; }
  }

  _renderList() {
    const listEl = this.shadowRoot.querySelector("[data-list]");
    const tabsEl = this.shadowRoot.querySelector(".cmc-tabs");
    if (!listEl) return;
    const g = this._listEntries();
    const zones = g.zones;
    const counts = { people: g.people.length, devices: g.devices.length, zones: zones.length };
    // 对齐官方：只保留有内容的分组；当前分组空了就落到第一个非空分组
    let tabs = this._tab;
    if (!tabs || !counts[tabs]) {
      tabs = ["people", "devices", "zones"].find((k) => counts[k] > 0) || "people";
    }
    this._tab = tabs;
    const hasAny = counts.people + counts.devices + counts.zones > 0;

    // Tab 药丸位置 + 无障碍属性（roving tabindex，官方 hui-map-overview 同款）
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
      // 只剩一组时官方会退化成标题（single-tab），这里隐藏滑块，按钮自然铺满
      tabsEl.classList.toggle("single", btns.filter((b) => !b.hidden).length <= 1);
      this._syncTabPill();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => this._syncTabPill());
      }
    }
    // tabpanel 的 aria-labelledby 跟着当前分组走
    listEl.setAttribute("aria-labelledby", `cmc-tab-${tabs}`);

    const rows = [];
    // 行结构对齐官方：ha-list-base > ha-list-item-button（headline / supporting-text 槽）
    const mkRow = (st, name, sub, picture) => `
      <ha-list-item-button class="cmc-item" data-entity="${st.entity_id}">
        <div class="cmc-item-av" slot="start" aria-hidden="true">${
          picture ? `<img src="${escapeAttr(picture)}" referrerpolicy="no-referrer" alt="">`
          : /^[a-z]+:/.test(this._icon(st)) ? `<ha-icon icon="${escapeAttr(this._icon(st))}"></ha-icon>`
          : escapeHtml(this._initial(name))}</div>
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

    listEl.innerHTML = rows.length
      ? `<ha-list-base>${rows.join("")}</ha-list-base>`
      : !hasAny
        ? `<div class="cmc-empty">地图上还没有可显示的实体</div>`
        : `<div class="cmc-empty">暂无${{ people: "人员", devices: "设备", zones: "区域" }[tabs]}</div>`;

    listEl.querySelectorAll("[data-entity]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = b.dataset.entity;
        if (!this._hass?.states?.[id]) return;
        // 对齐官方：点列表项 = 聚焦飞行 + 选中；已选中时再点开 more-info
        if (this._engine?._selectedEntity === id) {
          this._openMoreInfo(id);
        } else {
          this.focusEntity(id);
        }
      });
    });
  }

  getCardSize() {
    // 全屏模式下高度由视口决定，给个大值免得 HA 按 360px 排格子
    if (this._layout === LAYOUT.FULL || this.classList.contains("cmc-bleed")) return 10;
    // 官方 hui-map-card 的算法：有宽高比时按比例折算成 50px 一格
    const r = this._parseAspect(this._config?.aspect_ratio);
    if (r) return 1 + Math.floor(((100 * r.h) / r.w) / 25) || 3;
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
      grid_min_rows: g.min_rows,
    };
  }

  static async getConfigElement() {
    return document.createElement("ha-cn-map-card-editor");
  }
}


export { HaCnMapCard };
