/* ---- HaCnMapCardEditor：可视化编辑器 ---- */

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
    else if (el.type === "number") value = el.value === "" ? undefined : Number(el.value);
    else if (el.dataset.k === "hours_to_show") value = Number(el.value) || 0;
    else value = el.value;

    const cfg = { ...this._config };
    const keepZero = key === "hours_to_show";
    if (key === "layout" && value === "auto") delete cfg.layout;
    else if (value === "" || value === undefined || (value === 0 && !keepZero)) delete cfg[key];
    else cfg[key] = value;
    // 选了"总是铺满"就不该再被固定高度卡住
    if (key === "layout" && value === "full") delete cfg.height;

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
    let ents;
    if (String(id).startsWith("__source__")) {
      // source 条目按来源删（v1.1.5）
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
        // source 条目（{source: "nmap"}）没有 entity id，展示成「来源」行（v1.1.5）
        if (typeof e === "object" && !e.entity && e.source) {
          return `<div class="ent" data-id="__source__${e.source}">
            <span class="tag">source</span>
            <span class="name">geo_location 来源：${e.source}</span>
            <button class="del" title="移除">✕</button>
          </div>`;
        }
        const id = typeof e === "string" ? e : e.entity;
        if (!id) return "";
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
        el.checked = c[k] === undefined ? ["fit_entities", "show_cluster", "show_status", "show_accuracy", "show_zone_radius", "dedupe_trackers", "respect_hidden"].includes(k) : !!c[k];
      } else if (el.tagName === "SELECT") {
        el.value = k === "layout" ? (c[k] || "auto")
          : k === "theme_mode" ? (c[k] || "auto")
          : k === "label_mode" ? (c[k] || "name")
          : String(c[k] === undefined ? 0 : c[k]);
      } else {
        el.value = c[k] === undefined ? (el.dataset.k === "height" ? 360 : "") : c[k];
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


export { HaCnMapCardEditor };
