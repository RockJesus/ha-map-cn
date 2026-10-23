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
    this._pendingRows = []; // 外部 config 变化时清空待提交行
  }

  // HA 编辑器协议：前端创建编辑器后依次调用 setConfig() 与 hassChanged()
  hassChanged(hass) {
    this.hass = hass;
  }

  _update(changes) {
    const config = { ...this._config, ...changes };
    this._config = config;
    // 同步 lit property 触发即时重渲染（否则切换控件后界面不刷新，
    // 如切换供应商后样式下拉仍显示旧选项）
    this.config = config;
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
    const rows = entities.map((e, i) => {
      const row = typeof e === "string" ? { entity: e } : { ...e };
      return { index: i, pending: false, ...row };
    });
    // 待提交的空行（用户刚点"添加实体"尚未选择实体）——不写入 config，避免
    // 配置文件里累积 {"entity":""} 垃圾行（dyc v0.4.1 config 曾出现 6 个空行）
    return [
      ...rows,
      ...(this._pendingRows || []).map((r) => ({
        ...r,
        index: rows.length + this._pendingRows.indexOf(r),
        pending: true,
      })),
    ];
  }

  _normalizeEntities(rows) {
    return rows
      .map((r) => {
        if (typeof r === "string") {
          return r; // 字符串实体直接保留
        }
        if (!r || typeof r !== "object") {
          return null;
        }
        const { index, pending, ...rest } = r;
        if (!rest.entity) {
          return null; // 空实体行不产出（pending 行未选实体时同样过滤）
        }
        const keys = Object.keys(rest).filter(
          (k) => rest[k] !== undefined && rest[k] !== ""
        );
        return keys.length === 1 && keys[0] === "entity" ? rest.entity : rest;
      })
      .filter(Boolean);
  }

  _updateEntity(index, patch) {
    const rows = this._entityRows();
    const row = rows[index];
    if (!row) {
      return;
    }
    if (row.pending) {
      // pending 行位于 config 行之后：pendingIndex = index - configRows 数
      const pendingIndex = index - rows.length;
      if (patch.entity) {
        // pending 行选好实体 → 提交为真实行（追加到 config 尾部）
        const merged = { ...row, ...patch };
        const entities = this._normalizeEntities([
          ...this._config?.entities || [],
          ...(merged.color ? [{ ...merged }] : [merged.entity]),
        ]);
        this._pendingRows.splice(pendingIndex, 1);
        this._update({ entities });
      } else {
        this._pendingRows[pendingIndex] = { ...row, ...patch };
        this.requestUpdate();
      }
      return;
    }
    rows[index] = { ...row, ...patch };
    this._update({ entities: this._normalizeEntities(rows) });
  }

  _removeEntity(index) {
    const rows = this._entityRows();
    const row = rows[index];
    if (row?.pending) {
      this._pendingRows.splice(this._pendingRows.indexOf(row), 1);
      this.requestUpdate();
      return;
    }
    this._update({ entities: this._normalizeEntities(rows.filter((_, i) => i !== index)) });
  }

  _addEntity() {
    if (!this._pendingRows) {
      this._pendingRows = [];
    }
    this._pendingRows.push({ entity: "", pending: true });
    this.requestUpdate();
  }

  _onSourcesChange(ev) {
    const sources = ev.target.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    this._update({ geo_location_sources: sources });
  }

  // ---------- 条件编辑器（按条件显示实体，与官方卡片 conditions 一致） ----------
  _conditionRows() {
    const conds = this._config?.conditions || [];
    const isGroup = conds.length === 1 && conds[0]?.condition === "or";
    const flat = isGroup ? conds[0].conditions || [] : conds;
    return flat.map((c) => ({
      entity: c.entity || "",
      type:
        c.state !== undefined
          ? "state"
          : c.state_not !== undefined
            ? "state_not"
            : c.above !== undefined
              ? "above"
              : "below",
      value:
        c.state !== undefined
          ? c.state
          : c.state_not !== undefined
            ? c.state_not
            : c.above ?? c.below ?? "",
    }));
  }

  _conditionAnyMode() {
    const conds = this._config?.conditions;
    return !!(
      conds &&
      conds.length === 1 &&
      conds[0] &&
      conds[0].condition === "or"
    );
  }

  _buildConditions(rows, anyMode) {
    const flat = rows
      .filter((r) => r.entity)
      .map((r) => {
        if (r.type === "state_not") {
          return { entity: r.entity, state_not: r.value };
        }
        if (r.type === "above") {
          return { entity: r.entity, above: r.value };
        }
        if (r.type === "below") {
          return { entity: r.entity, below: r.value };
        }
        return { entity: r.entity, state: r.value };
      });
    if (!flat.length) {
      return undefined;
    }
    return anyMode ? [{ condition: "or", conditions: flat }] : flat;
  }

  _updateCondition(index, patch) {
    const rows = this._conditionRows();
    rows[index] = { ...rows[index], ...patch };
    this._update({ conditions: this._buildConditions(rows, this._conditionAnyMode()) });
  }

  _addCondition() {
    const rows = this._conditionRows();
    rows.push({ entity: "", type: "state", value: "on" });
    this._update({ conditions: this._buildConditions(rows, this._conditionAnyMode()) });
  }

  _removeCondition(index) {
    const rows = this._conditionRows().filter((_, i) => i !== index);
    this._update({ conditions: this._buildConditions(rows, this._conditionAnyMode()) });
  }

  _onConditionMode(ev) {
    const anyMode = ev.target.value === "any";
    this._update({ conditions: this._buildConditions(this._conditionRows(), anyMode) });
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
          <div class="row">
            <ha-formfield .label=${"区域圈层"}>
              <ha-switch
                .checked=${c.show_zones !== false}
                @change=${(ev) =>
                  this._update({ show_zones: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield .label=${"地图注记"}>
              <ha-switch
                .checked=${c.show_labels !== false}
                @change=${(ev) =>
                  this._update({ show_labels: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
            <ha-formfield .label=${"实时路况（高德）"}>
              <ha-switch
                .checked=${!!c.show_traffic}
                @change=${(ev) =>
                  this._update({ show_traffic: ev.target.checked })}
              ></ha-switch>
            </ha-formfield>
          </div>
          <div class="row">
            <ha-textfield
              .label=${"「家」标签"}
              .value=${c.home_label || "家"}
              @change=${(ev) => this._update({ home_label: ev.target.value })}
            ></ha-textfield>
            <ha-textfield
              .label=${"轨迹颜色"}
              .value=${c.track_color || "#e91e63"}
              @change=${(ev) => this._update({ track_color: ev.target.value })}
            ></ha-textfield>
            <ha-textfield
              .label=${"高德 Key（可选）"}
              .value=${c.amap_key || ""}
              @change=${(ev) => this._update({ amap_key: ev.target.value })}
            ></ha-textfield>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel .header=${"条件（按条件显示实体）"}>
          <p class="hint">
            实体仅在满足以下条件时显示在地图上；条件行 entity
            留空表示应用到所有实体
          </p>
          <div class="row">
            <ha-select
              .label=${"组合模式"}
              .value=${this._conditionAnyMode() ? "any" : "all"}
              @change=${this._onConditionMode}
            >
              <mwc-list-item .value=${"all"}>全部满足（AND）</mwc-list-item>
              <mwc-list-item .value=${"any"}>任一满足（OR）</mwc-list-item>
            </ha-select>
          </div>
          ${this._conditionRows().map(
            (row, i) => html`
              <div class="entity-row">
                <ha-entity-picker
                  .value=${row.entity}
                  @change=${(ev) =>
                    this._updateCondition(i, { entity: ev.target.value })}
                ></ha-entity-picker>
                <select
                  class="cond-type"
                  .value=${row.type}
                  @change=${(ev) =>
                    this._updateCondition(i, { type: ev.target.value })}
                >
                  <option value="state">状态等于</option>
                  <option value="state_not">状态不等于</option>
                  <option value="above">数值大于</option>
                  <option value="below">数值小于</option>
                </select>
                <ha-textfield
                  .label=${"条件值"}
                  .value=${row.value}
                  @change=${(ev) =>
                    this._updateCondition(i, { value: ev.target.value })}
                ></ha-textfield>
                <ha-icon-button
                  .label=${"删除条件"}
                  @click=${() => this._removeCondition(i)}
                >
                  <ha-icon icon="mdi:delete"></ha-icon>
                </ha-icon-button>
              </div>
            `
          )}
          <ha-button @click=${this._addCondition}>添加条件</ha-button>
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
    .cond-type {
      background: var(--input-fill-color, #f5f5f5);
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 8px;
      padding: 8px;
      color: var(--primary-text-color);
      font-size: 14px;
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
