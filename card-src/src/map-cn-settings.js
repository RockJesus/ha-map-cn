// map-cn-settings：中国地图卡片/面板的可视化设置抽屉（借鉴 ha-china-map settings 的
// 分类表单交互：地图 Key / 底图与显示 / 开关）。
// 事件：
//   map-cn-settings-save    detail = 新的选项对象（由宿主保存 localStorage 并应用）
//   map-cn-settings-closed
// 宿主在 panel/卡片工具栏点 ⚙️ 时调用 open(config, hass)。
import { LitElement, html, css, nothing } from "lit";

const PROVIDER_OPTIONS = [
  { value: "gaode", label: "高德地图（自动纠偏）" },
  { value: "tencent", label: "腾讯地图（自动纠偏）" },
  { value: "tianditu", label: "天地图（不偏移，需 Key）" },
];

class MapCnSettings extends LitElement {
  static properties = {
    _opened: { state: true },
    _config: { state: true },
    _err: { state: true },
  };

  static styles = css`
    :host { display: block; }
    .mask {
      position: fixed; inset: 0; background: rgba(0,0,0,.45);
      z-index: 10000; display: flex; align-items: center; justify-content: center;
      padding: 16px;
    }
    .dialog {
      width: min(560px, 100%); max-height: 88vh; overflow: auto;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #212121);
      border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.35);
      display: flex; flex-direction: column;
    }
    .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid var(--divider-color, #e0e0e0);
      font-size: 18px; font-weight: 500;
    }
    .head button {
      border: none; background: transparent; cursor: pointer;
      color: inherit; font-size: 20px;
    }
    .body { padding: 8px 20px 4px; overflow: auto; }
    .section {
      font-size: 13px; font-weight: 600; color: var(--secondary-text-color, #727272);
      margin: 14px 0 8px; letter-spacing: .3px;
    }
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .field label { font-size: 14px; }
    .field .hint { font-size: 12px; color: var(--secondary-text-color, #727272); line-height: 1.5; }
    .field input[type=text], .field input[type=password], .field select {
      width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px;
      border: 1px solid var(--divider-color, #ccc); border-radius: 8px;
      background: var(--card-background-color, #fff); color: inherit;
    }
    .field input[type=range] { width: 100%; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .row .lbl { font-size: 14px; }
    .switch { position: relative; width: 46px; height: 26px; flex: 0 0 46px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; inset: 0; background: var(--divider-color, #bbb);
      border-radius: 999px; cursor: pointer; transition: .2s;
    }
    .slider:before {
      content: ""; position: absolute; width: 20px; height: 20px;
      left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .2s;
    }
    .switch input:checked + .slider { background: var(--primary-color, #03a9f4); }
    .switch input:checked + .slider:before { transform: translateX(20px); }
    .val { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--primary-color, #03a9f4); }
    .foot {
      display: flex; gap: 10px; justify-content: flex-end;
      padding: 14px 20px; border-top: 1px solid var(--divider-color, #e0e0e0);
    }
    .btn {
      border: none; border-radius: 8px; padding: 10px 18px; font-size: 14px; cursor: pointer;
    }
    .btn.primary { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
    .btn.plain { background: transparent; color: var(--primary-color, #03a9f4); }
    .err { color: #d32f2f; font-size: 13px; padding: 0 20px 8px; }
  `;

  open(config, hass) {
    this._hass = hass;
    this._config = { ...(config || {}) };
    this._err = "";
    this._opened = true;
  }

  close() {
    this._opened = false;
    this.dispatchEvent(
      new CustomEvent("map-cn-settings-closed", { bubbles: true, composed: true })
    );
  }

  _g(key, def) {
    const v = this._config[key];
    return v !== undefined && v !== null ? v : def;
  }

  _collect() {
    const root = this.shadowRoot;
    const out = { ...this._config };
    root.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (el.dataset.type === "bool") out[k] = el.checked;
      else if (el.dataset.type === "number") out[k] = Number(el.value);
      else if (el.tagName === "SELECT") out[k] = el.value;
      else out[k] = el.value;
    });
    return out;
  }

  _onSave() {
    const opts = this._collect();
    if (opts.provider === "tianditu" && !opts.tianditu_key) {
      this._err = "选择天地图作为底图时，必须填写天地图 Key（tk）。";
      this.requestUpdate();
      return;
    }
    this.dispatchEvent(
      new CustomEvent("map-cn-settings-save", {
        detail: opts,
        bubbles: true,
        composed: true,
      })
    );
    this.close();
  }

  render() {
    if (!this._opened) {
      return nothing;
    }
    const v = this._config || {};
    const g = this._g.bind(this);
    const text = (k, d, type = "text") => html`
      <div class="field">
        <label>${this._label(k)}</label>
        <input type="${type}" data-k="${k}" .value=${g(k, d)} />
      </div>`;
    const num = (k, d, min, max) => html`
      <div class="field">
        <label>${this._label(k)} <span class="val" data-v="${k}">${g(k, d)}</span></label>
        <input type="range" data-k="${k}" data-type="number" min="${min}" max="${max}"
          .value=${g(k, d)} @input=${(e) => {
            const s = this.shadowRoot.querySelector(`[data-v="${k}"]`);
            if (s) s.textContent = e.target.value;
          }} />
      </div>`;
    const sel = (k, d, opts) => html`
      <div class="field">
        <label>${this._label(k)}</label>
        <select data-k="${k}">
          ${opts.map(
            (o) =>
              html`<option value=${o.value} ?selected=${g(k, d) === o.value}>${o.label}</option>`
          )}
        </select>
      </div>`;
    const bool = (k, d) => html`
      <div class="row">
        <span class="lbl">${this._label(k)}</span>
        <label class="switch">
          <input type="checkbox" data-k="${k}" data-type="bool" ?checked=${g(k, d)} />
          <span class="slider"></span>
        </label>
      </div>`;

    return html`
      <div class="mask" @click=${(e) => {
        if (e.target.classList.contains("mask")) this.close();
      }}>
        <div class="dialog">
          <div class="head">
            <span>地图设置</span>
            <button @click=${() => this.close()}>✕</button>
          </div>
          <div class="body">
            <div class="section">地图 Key</div>
            ${text("tianditu_key", "")}
            <div class="hint" style="margin:-8px 0 14px">
              天地图免费，无坐标偏移（推荐首选）。申请：https://lbs.tianditu.gov.cn/
            </div>
            ${text("amap_key", "", "password")}
            <div class="hint" style="margin:-8px 0 14px">高德 Key 可选（公开瓦片无需 Key）。</div>

            <div class="section">底图与显示</div>
            ${sel("provider", "gaode", PROVIDER_OPTIONS)}
            ${sel(
              "style",
              "normal",
              [
                { value: "normal", label: "标准街道图" },
                { value: "satellite", label: "卫星影像" },
              ]
            )}
            ${sel(
              "theme_mode",
              "auto",
              [
                { value: "auto", label: "跟随系统" },
                { value: "light", label: "亮色" },
                { value: "dark", label: "暗色" },
              ]
            )}
            ${num("default_zoom", 14, 3, 19)}
            ${num("max_zoom", 18, 10, 19)}
            ${num("hours_to_show", 24, 0, 168)}
            ${text("home_label", "家")}
            ${text("track_color", "#e91e63")}

            <div class="section">开关</div>
            ${bool("show_traffic", false)}
            ${bool("show_zones", true)}
            ${bool("show_labels", true)}
          </div>
          <div class="err" ?hidden=${!this._err}>${this._err}</div>
          <div class="foot">
            <button class="btn plain" @click=${() => this.close()}>取消</button>
            <button class="btn primary" @click=${() => this._onSave()}>保存并应用</button>
          </div>
        </div>
      </div>
    `;
  }

  _label(key) {
    const labels = {
      tianditu_key: "天地图 Key（tk）",
      amap_key: "高德 Key（可选）",
      provider: "默认底图服务商",
      style: "默认地图样式",
      theme_mode: "主题模式",
      default_zoom: "默认缩放级别",
      max_zoom: "最大瓦片级别",
      hours_to_show: "轨迹历史时长（小时）",
      home_label: "「家」标签文案",
      track_color: "轨迹颜色",
      show_traffic: "显示实时路况（高德）",
      show_zones: "显示区域（Zone）",
      show_labels: "显示地图注记",
    };
    return labels[key] || key;
  }
}

if (!customElements.get("map-cn-settings")) {
  customElements.define("map-cn-settings", MapCnSettings);
}

export default MapCnSettings;
