// map-cn-card-editor：中国地图卡片配置编辑器（复用 HA 全局组件）
import { LitElement, html, css, nothing } from "lit";

const PROVIDERS = [
  ["gaode", "高德地图"],
  ["tencent", "腾讯地图"],
  ["tianditu", "天地图（需 key）"],
  ["osm", "OpenStreetMap"],
];
const STYLES = [
  ["normal", "标准"],
  ["light", "浅色"],
  ["satellite", "卫星"],
  ["dark", "深色"],
];
const THEME_MODES = [
  ["auto", "跟随主题"],
  ["light", "浅色"],
  ["dark", "深色"],
];

class MapCnCardEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    config: { attribute: false },
  };

  setConfig(config) {
    this._config = { ...(config || {}) };
  }

  _update(changes) {
    const config = { ...this._config, ...changes };
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _onEntitiesChange(ev) {
    const lines = ev.target.value
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    this._update({ entities: lines });
  }

  render() {
    const c = this._config || {};
    const entitiesText = (c.entities || [])
      .map((e) => (typeof e === "string" ? e : e.entity))
      .join("\n");
    return html`
      <div class="editor">
        <div class="row">
          <ha-select
            .label=${"底图供应商"}
            .value=${c.provider || "gaode"}
            @change=${(ev) => this._update({ provider: ev.target.value })}
          >
            ${PROVIDERS.map(
              ([v, label]) =>
                html`<mwc-list-item .value=${v}>${label}</mwc-list-item>`
            )}
          </ha-select>
          <ha-select
            .label=${"地图样式"}
            .value=${c.style || "normal"}
            @change=${(ev) => this._update({ style: ev.target.value })}
          >
            ${STYLES.map(
              ([v, label]) =>
                html`<mwc-list-item .value=${v}>${label}</mwc-list-item>`
            )}
          </ha-select>
          <ha-select
            .label=${"深浅模式"}
            .value=${c.theme_mode || "auto"}
            @change=${(ev) => this._update({ theme_mode: ev.target.value })}
          >
            ${THEME_MODES.map(
              ([v, label]) =>
                html`<mwc-list-item .value=${v}>${label}</mwc-list-item>`
            )}
          </ha-select>
        </div>
        ${
          c.provider === "tianditu"
            ? html`<ha-textfield
                .label=${"天地图 Key（www.tianditu.gov.cn 免费申请）"}
                .value=${c.tianditu_key || ""}
                @change=${(ev) => this._update({ tianditu_key: ev.target.value })}
              ></ha-textfield>`
            : nothing
        }
        <ha-textfield
          .label=${"标题"}
          .value=${c.title || ""}
          @change=${(ev) => this._update({ title: ev.target.value })}
        ></ha-textfield>
        <ha-textfield
          .label=${"宽高比（如 16/9，留空为 1:1）"}
          .value=${c.aspect_ratio || ""}
          @change=${(ev) => this._update({ aspect_ratio: ev.target.value })}
        ></ha-textfield>
        <div class="row">
          <ha-textfield
            .label=${"默认缩放级别"}
            type="number"
            .value=${String(c.default_zoom ?? 14)}
            @change=${(ev) =>
              this._update({ default_zoom: Number(ev.target.value) })}
          ></ha-textfield>
          <ha-textfield
            .label=${"轨迹显示小时数（0 关闭）"}
            type="number"
            .value=${String(c.hours_to_show ?? 0)}
            @change=${(ev) =>
              this._update({ hours_to_show: Number(ev.target.value) })}
          ></ha-textfield>
        </div>
        <ha-expansion-panel .header=${"实体与高级选项"}>
          <div class="row">
            <ha-formfield .label=${"显示全部定位实体"}>
              <ha-switch
                .checked=${!!c.show_all}
                @change=${(ev) => this._update({ show_all: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield .label=${"自动视野"}>
              <ha-switch
                .checked=${!!c.auto_fit}
                @change=${(ev) => this._update({ auto_fit: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield .label=${"聚合标记"}>
              <ha-switch
                .checked=${c.cluster !== false}
                @change=${(ev) => this._update({ cluster: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
          </div>
          <div class="row">
            <ha-formfield .label=${"显示区域半径"}>
              <ha-switch
                .checked=${c.show_zone_radius !== false}
                @change=${(ev) =>
                  this._update({ show_zone_radius: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield .label=${"比例尺"}>
              <ha-switch
                .checked=${!!c.scale_ruler}
                @change=${(ev) =>
                  this._update({ scale_ruler: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield .label=${"视野含区域"}>
              <ha-switch
                .checked=${!!c.fit_zones}
                @change=${(ev) => this._update({ fit_zones: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
          </div>
          <p class="hint">
            实体列表（每行一个 entity_id，如 person.zhang_san /
            zone.home）
          </p>
          <ha-textarea
            .label=${"实体"}
            .value=${entitiesText}
            @change=${this._onEntitiesChange}
          ></ha-textarea>
        </ha-expansion-panel>
      </div>
    `;
  }

  static styles = css`
    .editor {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 8px 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .hint {
      color: var(--secondary-text-color);
      font-size: 12px;
      margin: 0;
    }
    ha-expansion-panel {
      --expansion-panel-border-radius: 8px;
    }
  `;
}

customElements.define("map-cn-card-editor", MapCnCardEditor);
