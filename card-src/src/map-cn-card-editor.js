// map-cn-card-editor：中国地图卡片可视化配置编辑器
// 实体用 ha-entity-picker 逐行选择（支持 color），全部选项均有 UI 控件
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
// 各供应商可用样式（腾讯无公开卫星瓦片——官方 SATELLITE 走自定义 ImageMapType）
const PROVIDER_STYLES = {
  gaode: STYLES,
  tencent: [
    ["normal", "标准"],
    ["light", "浅色"],
    ["dark", "深色"],
  ],
  tianditu: STYLES,
  osm: STYLES,
};
const THEME_MODES = [
  ["auto", "跟随主题"],
  ["light", "浅色"],
  ["dark", "深色"],
];
// 官方 MAP_STYLES（src/common/map/map-styles.ts）：编辑器选项顺序与官方一致
const MAP_STYLES = [
  ["default", "默认"],
  ["colorful", "彩色"],
  ["natural", "自然"],
  ["muted", "素雅"],
  ["gray", "灰度"],
  ["toner", "墨色"],
];
const ENTITY_DOMAINS = ["person", "device_tracker", "zone", "geo_location"];

class MapCnCardEditor extends LitElement {
  static properties = {
    hass: { attribute: false },
    config: { attribute: false },
  };

  setConfig(config) {
    this._config = { ...(config || {}) };
  }

  // HA 编辑器协议：前端创建编辑器后依次调用 setConfig() 与 hassChanged()
  hassChanged(hass) {
    this.hass = hass;
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

  _entityRows() {
    const entities = this._config?.entities || [];
    return entities.map((e, i) => {
      const row = typeof e === "string" ? { entity: e } : { ...e };
      return { index: i, ...row };
    });
  }

  _normalizeEntities(rows) {
    return rows.map((r) => {
      const { index, ...rest } = r;
      const keys = Object.keys(rest).filter(
        (k) => rest[k] !== undefined && rest[k] !== ""
      );
      return keys.length === 1 && keys[0] === "entity" ? rest.entity : rest;
    });
  }

  _updateEntity(index, patch) {
    const rows = this._entityRows();
    rows[index] = { ...rows[index], ...patch };
    this._update({ entities: this._normalizeEntities(rows) });
  }

  _removeEntity(index) {
    const rows = this._entityRows().filter((_, i) => i !== index);
    this._update({ entities: this._normalizeEntities(rows) });
  }

  _addEntity() {
    this._update({
      entities: [...(this._config?.entities || []), { entity: "" }],
    });
  }

  _onSourcesChange(ev) {
    const sources = ev.target.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    this._update({ geo_location_sources: sources });
  }

  render() {
    const c = this._config || {};
    const rows = this._entityRows();
    const showAll = !!c.show_all;
    const providerVal = c.provider || "gaode";
    const styleOptions =
      PROVIDER_STYLES[providerVal] || PROVIDER_STYLES.gaode;
    const sourcesValue = (c.geo_location_sources || [])
      .map((s) => (typeof s === "string" ? s : s.source))
      .join(", ");
    return html`
      <div class="editor">
        <div class="row">
          <ha-select
            .label=${"底图供应商"}
            .value=${providerVal}
            @change=${(ev) => {
              const p = ev.target.value;
              const opts = PROVIDER_STYLES[p] || PROVIDER_STYLES.gaode;
              const cur = this._config?.style || "normal";
              this._update({
                provider: p,
                style: opts.some(([v]) => v === cur) ? cur : "normal",
              });
            }}
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
            ${styleOptions.map(
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
          <ha-select
            .label=${"渲染风格（map_style）"}
            .value=${c.map_style || "default"}
            @change=${(ev) => this._update({ map_style: ev.target.value })}
          >
            ${MAP_STYLES.map(
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
        <div class="row">
          <ha-textfield
            .label=${"宽高比（如 16/9，留空为 1:1）"}
            .value=${c.aspect_ratio || ""}
            @change=${(ev) => this._update({ aspect_ratio: ev.target.value })}
          ></ha-textfield>
          <ha-textfield
            .label=${"默认缩放级别"}
            type="number"
            .value=${String(c.default_zoom ?? 14)}
            @change=${(ev) =>
              this._update({ default_zoom: Number(ev.target.value) })}
          ></ha-textfield>
          <ha-textfield
            .label=${"轨迹小时数（0 关闭）"}
            type="number"
            .value=${String(c.hours_to_show ?? 0)}
            @change=${(ev) =>
              this._update({ hours_to_show: Number(ev.target.value) })}
          ></ha-textfield>
        </div>

        <ha-expansion-panel .header=${"实体"}>
          ${
            rows.length
              ? rows.map(
                  (row) => html`
                    <div class="entity-row">
                      <ha-entity-picker
                        .hass=${this.hass}
                        .value=${row.entity}
                        .includeDomains=${ENTITY_DOMAINS}
                        .allowCustomEntity=${true}
                        @change=${(ev) =>
                          this._updateEntity(row.index, {
                            entity: ev.target.value,
                          })}
                      ></ha-entity-picker>
                      <ha-textfield
                        class="color"
                        .label=${"颜色"}
                        .value=${row.color || ""}
                        placeholder="#ff0000"
                        @change=${(ev) =>
                          this._updateEntity(row.index, {
                            color: ev.target.value,
                          })}
                      ></ha-textfield>
                      <ha-icon-button
                        .label=${"删除实体"}
                        @click=${() => this._removeEntity(row.index)}
                        ><ha-icon icon="mdi:delete"></ha-icon
                      ></ha-icon-button>
                    </div>
                  `
                )
              : html`<p class="hint">未添加实体</p>`
          }
          <ha-button .disabled=${showAll} @click=${this._addEntity}
            >添加实体</ha-button
          >
          <ha-formfield .label=${"显示全部定位实体（不逐个选择）"}>
            <ha-switch
              .checked=${showAll}
              @change=${(ev) => this._update({ show_all: ev.target.checked })}
            ></ha-switch>
          </ha-formfield>
        </ha-expansion-panel>

        <ha-expansion-panel .header=${"geo_location 来源（逗号分隔）"}>
          <ha-textfield
            .label=${"来源列表，如 geolocation / owntracks"}
            .value=${sourcesValue}
            @change=${this._onSourcesChange}
          ></ha-textfield>
        </ha-expansion-panel>

        <ha-expansion-panel .header=${"高级选项"}>
          <div class="row">
            <ha-formfield .label=${"自动视野"}>
              <ha-switch
                .checked=${!!c.auto_fit}
                @change=${(ev) => this._update({ auto_fit: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield .label=${"视野含区域"}>
              <ha-switch
                .checked=${!!c.fit_zones}
                @change=${(ev) => this._update({ fit_zones: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield .label=${"标记聚合"}>
              <ha-switch
                .checked=${c.cluster !== false}
                @change=${(ev) => this._update({ cluster: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
          </div>
          <div class="row">
            <ha-formfield .label=${"区域半径圈"}>
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
            <ha-formfield .label=${"强制深色"}>
              <ha-switch
                .checked=${!!c.dark_mode}
                @change=${(ev) => this._update({ dark_mode: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
          </div>
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
    .entity-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .entity-row ha-entity-picker {
      flex: 1;
    }
    .entity-row .color {
      width: 110px;
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

customElements.define("map-cn-editor", MapCnCardEditor);
