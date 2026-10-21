// map-cn-overview：Overview 抽屉（对齐官方 hui-map-overview.ts）
// panel 布局下显示：人/设备/区域 tabs（只显有内容的 tab）+ 实体列表 + 详情页（活动时间线）
// 桌面：左侧浮动面板；手机（≤600px）：底部面板
// 事件：map-overview-select（选择实体/返回）、map-overview-tab、map-overview-resize
import { LitElement, html, css, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { entityMapColor, zoneColor } from "./colors";

const ACTIVITY_HOURS = 24;
const ACTIVITY_INITIAL_ENTRIES = 5;
const ACTIVITY_MAX_ENTRIES = 20;
const HOME_ZONE_ENTITY_ID = "zone.home";

const computeDomain = (entityId) => entityId.split(".")[0];

const getEntityLocation = (stateObj) => {
  if (!stateObj) {
    return undefined;
  }
  const { latitude, longitude } = stateObj.attributes;
  return typeof latitude === "number" && typeof longitude === "number"
    ? { latitude, longitude }
    : undefined;
};

// 与官方 map-activity.ts 一致；zoneActivity 额外接受 stateFallback（无 in_zones 属性的旧版 HA 回退）
const NO_LOCATION_STATES = ["unavailable", "unknown"];
const personActivity = (history, since) => {
  const entries = [];
  let previous;
  for (const entry of history ?? []) {
    if (NO_LOCATION_STATES.includes(entry.s)) {
      continue;
    }
    const changed = entry.s !== previous;
    previous = entry.s;
    if (!changed || entry.lu * 1000 < since) {
      continue;
    }
    entries.push({ state: entry.s, when: new Date(entry.lu * 1000) });
  }
  return entries.reverse().slice(0, ACTIVITY_MAX_ENTRIES);
};

const zoneActivity = (history, personIds, zoneId, stateFallback, since) => {
  const entries = [];
  for (const personId of personIds) {
    let wasInZone;
    for (const entry of history?.[personId] ?? []) {
      if (NO_LOCATION_STATES.includes(entry.s)) {
        continue;
      }
      // 官方语义：in_zones 属性数组（权威）；旧版 HA 无该属性时回退 state 比较
      const inZone =
        (entry.a?.in_zones || []).includes(zoneId) ||
        (stateFallback !== undefined && entry.s === stateFallback);
      if (wasInZone === undefined && entry.lu * 1000 < since) {
        // 窗口起点前的状态仅用于判断是否“刚进入”
        wasInZone = inZone;
        continue;
      }
      const changed = wasInZone !== inZone;
      wasInZone = inZone;
      if (!changed || entry.lu * 1000 < since) {
        continue;
      }
      entries.push({
        state: entry.s,
        when: new Date(entry.lu * 1000),
        personId,
        arrived: inZone,
      });
    }
  }
  return entries
    .sort((a, b) => b.when.getTime() - a.when.getTime())
    .slice(0, ACTIVITY_MAX_ENTRIES);
};

const zoneInitials = (name) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

const formatTime = (date) => {
  try {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const relativeTime = (date) => {
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) {
    return "刚刚";
  }
  if (mins < 60) {
    return `${mins} 分钟前`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.round(hours / 24)} 天前`;
};

class MapCnOverview extends LitElement {
  static properties = {
    hass: { attribute: false },
    entities: { attribute: false },
    selected: { attribute: false },
    tab: { attribute: false },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: min(360px, 100%);
      max-height: calc(100% - 24px);
      overflow: hidden;
      background: var(--ha-card-background, var(--card-background-color, #fff));
      border: 1px solid var(--ha-card-border-color, rgba(0, 0, 0, 0.12));
      border-radius: var(--ha-card-border-radius, 12px);
      box-shadow: var(--ha-card-box-shadow, 0 2px 12px rgba(0, 0, 0, 0.15));
      color: var(--primary-text-color, #1c1c1e);
      font-size: 14px;
    }
    .tabs {
      position: relative;
      display: flex;
      padding: 8px;
      gap: 4px;
    }
    .tablist {
      display: flex;
      gap: 4px;
      flex: 1;
    }
    button.pill {
      flex: 1;
      border: none;
      background: var(--ha-card-background, transparent);
      color: var(--secondary-text-color, #727272);
      padding: 6px 12px;
      border-radius: 16px;
      font-size: 13px;
      cursor: pointer;
    }
    button.pill[aria-selected="true"] {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      font-weight: 500;
    }
    .heading {
      padding: 10px 14px 4px;
      font-weight: 500;
      color: var(--secondary-text-color, #727272);
      font-size: 13px;
    }
    .list {
      overflow-y: auto;
      padding: 4px 0;
    }
    ha-list-base,
    .items {
      display: flex;
      flex-direction: column;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 14px;
      border: none;
      background: transparent;
      width: 100%;
      text-align: start;
      cursor: pointer;
      color: var(--primary-text-color, #1c1c1e);
    }
    .item:hover {
      background: var(--sidebar-selected-background, rgba(0, 0, 0, 0.05));
    }
    .item.no-location {
      opacity: 0.6;
    }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      flex: none;
      overflow: hidden;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .avatar.rail {
      background: transparent;
      border: 2px solid currentColor;
      box-sizing: border-box;
      color: var(--secondary-text-color, #727272);
      font-size: 11px;
    }
    .item-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .item-headline {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-supporting {
      color: var(--secondary-text-color, #727272);
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* 详情 */
    .detail-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 8px 8px 4px;
      border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    }
    .detail-header button.back {
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 18px;
      padding: 6px;
      color: var(--primary-text-color, #1c1c1e);
      border-radius: 50%;
    }
    .detail-header button.back:hover {
      background: rgba(0, 0, 0, 0.08);
    }
    .detail-title {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .detail-name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .detail-state {
      font-size: 12px;
      color: var(--secondary-text-color, #727272);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* 活动时间线 */
    .activity {
      padding: 8px 14px;
    }
    .activity-header {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--secondary-text-color, #727272);
      font-size: 13px;
      font-weight: 500;
      padding: 4px 0 8px;
    }
    .activity-title {
      font-size: 13px;
    }
    .activity-loading {
      padding: 12px 0;
      display: flex;
      justify-content: center;
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid var(--divider-color, rgba(0, 0, 0, 0.2));
      border-top-color: var(--primary-color, #03a9f4);
      border-radius: 50%;
      animation: map-cn-spin 0.8s linear infinite;
    }
    @keyframes map-cn-spin {
      to {
        transform: rotate(360deg);
      }
    }
    .activity-empty {
      color: var(--secondary-text-color, #727272);
      font-size: 13px;
      padding: 8px 0;
    }
    .entry {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 5px 0;
    }
    .entry .avatar {
      width: 30px;
      height: 30px;
      font-size: 12px;
    }
    .entry-text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .entry-headline {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .entry-when {
      font-size: 12px;
      color: var(--secondary-text-color, #727272);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .show-more {
      border: none;
      background: transparent;
      color: var(--primary-color, #03a9f4);
      cursor: pointer;
      font-size: 13px;
      padding: 8px 2px;
    }
    /* 手机：底部面板 */
    @media (max-width: 600px) {
      :host {
        width: 100%;
        max-height: 70%;
        border-radius: 12px 12px 0 0;
      }
    }
  `;

  constructor() {
    super();
    this._activity = undefined;
    this._activityFailed = false;
    this._activityExpanded = false;
    this._activityRequest = 0;
  }

  // 组件在卡片 shadow 内，直接读 hass（card 传入）
  get _states() {
    return this.hass?.states || {};
  }

  get _i18n() {
    return this.hass?.locale || {};
  }

  get _user() {
    return this.hass?.user;
  }

  _isMe(stateObj) {
    return (
      !!this._user &&
      computeDomain(stateObj.entity_id) === "person" &&
      stateObj.attributes.user_id === this._user.id
    );
  }

  _entityName(stateObj) {
    const configured = this._configuredNames().get(stateObj.entity_id);
    if (configured) {
      return configured;
    }
    try {
      if (this.hass?.formatEntityName) {
        return this.hass.formatEntityName(stateObj) || stateObj.entity_id;
      }
    } catch {
      /* fallback */
    }
    return stateObj.attributes?.friendly_name || stateObj.entity_id;
  }

  _personName(stateObj) {
    return this._isMe(stateObj) ? "我" : this._entityName(stateObj);
  }

  _configuredNames = () => {
    const map = new Map();
    for (const entity of this.entities || []) {
      if (entity.name) {
        map.set(entity.entity_id, entity.name);
      }
    }
    return map;
  };

  _getPeople() {
    return (this.entities || [])
      .map((entity) => this._states[entity.entity_id])
      .filter(
        (stateObj) =>
          !!stateObj && computeDomain(stateObj.entity_id) === "person"
      )
      .sort((a, b) => {
        const aMe = this._isMe(a);
        if (aMe !== this._isMe(b)) {
          return aMe ? -1 : 1;
        }
        const aLocated = !!getEntityLocation(a, this._states);
        const bLocated = !!getEntityLocation(b, this._states);
        if (aLocated !== bLocated) {
          return aLocated ? -1 : 1;
        }
        return this._entityName(a).localeCompare(
          this._entityName(b),
          this._i18n.language
        );
      });
  }

  _getDevices() {
    return (this.entities || [])
      .map((entity) => this._states[entity.entity_id])
      .filter(
        (stateObj) =>
          !!stateObj &&
          computeDomain(stateObj.entity_id) === "device_tracker" &&
          !!getEntityLocation(stateObj, this._states)
      )
      .sort((a, b) =>
        this._entityName(a).localeCompare(this._entityName(b), this._i18n.language)
      );
  }

  _getZones() {
    return (this.entities || [])
      .map((entity) => this._states[entity.entity_id])
      .filter(
        (stateObj) =>
          !!stateObj &&
          computeDomain(stateObj.entity_id) === "zone" &&
          !stateObj.attributes.passive &&
          stateObj.attributes.latitude !== undefined &&
          stateObj.attributes.longitude !== undefined
      )
      .sort((a, b) => {
        if (
          (a.entity_id === HOME_ZONE_ENTITY_ID) !==
          (b.entity_id === HOME_ZONE_ENTITY_ID)
        ) {
          return a.entity_id === HOME_ZONE_ENTITY_ID ? -1 : 1;
        }
        return this._entityName(a).localeCompare(
          this._entityName(b),
          this._i18n.language
        );
      });
  }

  _itemsPerTab(people, devices, zones) {
    const out = {};
    if (people.length) {
      out.people = people;
    }
    if (devices.length) {
      out.devices = devices;
    }
    if (zones.length) {
      out.zones = zones;
    }
    return out;
  }

  updated(changedProps) {
    // 当前 tab 无内容时切到第一个有内容的 tab
    const tabs = Object.keys(
      this._itemsPerTab(this._getPeople(), this._getDevices(), this._getZones())
    );
    if (tabs.length && !tabs.includes(this.tab)) {
      this._fireTab(tabs[0]);
    }
    if (changedProps.has("selected") && this.selected) {
      this._loadActivity();
    }
  }

  willUpdate(changedProps) {
    if (changedProps.has("selected")) {
      this._activity = undefined;
      this._activityFailed = false;
      this._activityExpanded = false;
      this._activityRequest += 1;
    }
  }

  _activitySince() {
    return Date.now() - ACTIVITY_HOURS * 3600 * 1000;
  }

  async _fetchHistory(entityIds, since) {
    try {
      const result = await this.hass.connection.sendMessagePromise({
        type: "history/history_period",
        start_time: new Date(since).toISOString(),
        end_time: new Date().toISOString(),
        entity_ids: entityIds,
        minimal_response: false,
        significant_changes_only: false,
        no_attributes: false,
      });
      return result;
    } catch {
      return null;
    }
  }

  async _loadActivity() {
    const request = ++this._activityRequest;
    const entityId = this.selected;
    const since = this._activitySince();
    const domain = computeDomain(entityId);
    let history;
    if (domain === "zone") {
      const zone = this._states[entityId];
      if (!zone) {
        this._activity = [];
        return;
      }
      const personIds = this._getPeople().map((person) => person.entity_id);
      history = personIds.length
        ? await this._fetchHistory(personIds, since)
        : {};
      if (request !== this._activityRequest) {
        return;
      }
      if (history === null) {
        this._activityFailed = true;
        this._activity = [];
        return;
      }
      const stateFallback =
        entityId === HOME_ZONE_ENTITY_ID ? "home" : this._entityName(zone);
      this._activity = zoneActivity(history, personIds, entityId, stateFallback, since);
    } else {
      history = await this._fetchHistory([entityId], since);
      if (request !== this._activityRequest) {
        return;
      }
      if (history === null) {
        this._activityFailed = true;
        this._activity = [];
        return;
      }
      this._activity = personActivity(history?.[entityId], since);
    }
  }

  render() {
    const people = this._getPeople();
    const devices = this._getDevices();
    const zones = this._getZones();
    if (!people.length && !devices.length && !zones.length) {
      return nothing;
    }
    const selectedStateObj = this.selected
      ? this._states[this.selected]
      : undefined;
    return selectedStateObj
      ? this._renderDetail(selectedStateObj)
      : this._renderList(people, devices, zones);
  }

  _renderDetail(stateObj) {
    const isZone = computeDomain(stateObj.entity_id) === "zone";
    const zoneCount = isZone ? Number(stateObj.state) : undefined;
    const isMe = this._isMe(stateObj);
    const avatar = this._avatar(stateObj, 36, isMe ? "我" : undefined);
    return html`
      <div class="detail-header">
        <button class="back" aria-label="返回" @click=${this._handleBack}>
          ←
        </button>
        ${avatar}
        <div class="detail-title">
          <span class="detail-name">${this._personName(stateObj)}</span>
          <span class="detail-state">
            ${
              isZone
                ? zoneCount === undefined || Number.isNaN(zoneCount)
                  ? nothing
                  : `${zoneCount} 人`
                : html`${this._formatState(stateObj)} · ${relativeTime(
                    new Date(stateObj.last_updated)
                  )}`
            }
          </span>
        </div>
      </div>
      <div class="list">
        <div class="activity">
          <div class="activity-header">
            <span class="activity-title">活动</span>
          </div>
          ${
            !this._activity
              ? html`<div class="activity-loading"
                  ><div class="spinner"></div
                ></div>`
              : !this._activity.length
                ? html`<span class="activity-empty"
                    >${
                      this._activityFailed
                        ? "活动不可用"
                        : "最近 24 小时无活动"
                    }</span
                  >`
                : this._renderTimeline(stateObj, this._activity)
          }
        </div>
      </div>
    `;
  }

  _zoneForState(entityState) {
    if (entityState === "not_home" || entityState === "unknown") {
      return undefined;
    }
    if (entityState === "home") {
      return this._states[HOME_ZONE_ENTITY_ID];
    }
    return Object.values(this._states).find(
      (candidate) =>
        computeDomain(candidate.entity_id) === "zone" &&
        this._entityName(candidate) === entityState
    );
  }

  _renderTimeline(stateObj, activity) {
    const shown = this._activityExpanded
      ? activity
      : activity.slice(0, ACTIVITY_INITIAL_ENTRIES);
    return html`
      <div class="timeline">
        ${shown.map((entry) => this._renderActivityEntry(stateObj, entry))}
      </div>
      ${
        activity.length > shown.length
          ? html`<button class="show-more" @click=${this._showAllActivity}
              >显示更多</button
            >`
          : nothing
      }
    `;
  }

  _renderActivityEntry(stateObj, entry) {
    const person = entry.personId ? this._states[entry.personId] : undefined;
    const headline = entry.personId
      ? person
        ? this._personName(person)
        : entry.personId
      : this._formatState(stateObj, entry.state);
    const zone = entry.personId ? undefined : this._zoneForState(entry.state);
    const tile = zone
      ? this._avatar(zone, 30, zoneInitials(this._entityName(zone)))
      : person
        ? this._avatar(person, 30, this._personName(person)[0])
        : html`<span class="avatar rail"></span>`;
    return html`
      <div class="entry">
        ${tile}
        <div class="entry-text">
          <span class="entry-headline">${headline}</span>
          <span class="entry-when">
            ${
              entry.personId
                ? html`${entry.arrived ? "进入" : "离开"} · `
                : nothing
            }
            ${formatTime(entry.when)} · ${relativeTime(entry.when)}
          </span>
        </div>
      </div>
    `;
  }

  _showAllActivity() {
    this._activityExpanded = true;
  }

  _renderList(people, devices, zones) {
    const itemsPerTab = this._itemsPerTab(people, devices, zones);
    const tabs = Object.keys(itemsPerTab);
    const tab = tabs.includes(this.tab) ? this.tab : tabs[0];
    const items = itemsPerTab[tab] || [];
    const tabNames = { people: "人", devices: "设备", zones: "区域" };
    // 与官方一致：单 Tab 时收窄抽屉（#overview[single-tab]）
    this.toggleAttribute("single-tab", tabs.length === 1);
    if (tabs.length === 1) {
      return html`
        <div class="heading">${tabNames[tab]}</div>
        ${this._renderItems(tab, items)}
      `;
    }
    return html`
      <div class="tabs">
        <div class="tablist" role="tablist">
          ${tabs.map(
            (tabId) => html`
              <button
                type="button"
                role="tab"
                aria-selected=${tab === tabId}
                data-tab=${tabId}
                class="pill"
                @click=${this._handleTabClick}
              >
                ${tabNames[tabId]}
              </button>
            `
          )}
        </div>
      </div>
      ${this._renderItems(tab, items)}
    `;
  }

  _renderItems(tab, items) {
    return html`
      <div class="list" role="tabpanel">
        <div class="items">
          ${
            tab === "zones"
              ? items.map((stateObj) => this._renderZone(stateObj))
              : items.map((stateObj) => this._renderEntity(stateObj))
          }
        </div>
      </div>
    `;
  }

  _renderEntity(stateObj) {
    const name = this._personName(stateObj);
    const location = getEntityLocation(stateObj, this._states);
    const avatar = this._avatar(
      stateObj,
      36,
      this._isMe(stateObj) ? "我" : name[0]
    );
    return html`
      <button
        class="item ${location ? "" : "no-location"}"
        data-entity-id=${stateObj.entity_id}
        @click=${this._handleItemClick}
      >
        ${avatar}
        <span class="item-text">
          <span class="item-headline">${name}</span>
          <span class="item-supporting"
            >${this._formatState(stateObj)} · ${relativeTime(
              new Date(stateObj.last_updated)
            )}</span
          >
        </span>
      </button>
    `;
  }

  _renderZone(stateObj) {
    const count = Number(stateObj.state);
    const avatar = this._avatar(
      stateObj,
      36,
      zoneInitials(this._entityName(stateObj))
    );
    return html`
      <button
        class="item"
        data-entity-id=${stateObj.entity_id}
        @click=${this._handleItemClick}
      >
        ${avatar}
        <span class="item-text">
          <span class="item-headline">${this._entityName(stateObj)}</span>
          <span class="item-supporting"
            >${Number.isNaN(count) ? nothing : `${count} 人`}</span
          >
        </span>
      </button>
    `;
  }

  _avatar(stateObj, size, fallbackInitial) {
    const entityId = stateObj.entity_id;
    const color = this._entityColor(entityId, stateObj);
    const picture = stateObj.attributes?.entity_picture;
    const style = { background: color, width: `${size}px`, height: `${size}px` };
    return html`<span class="avatar" style=${styleMap(style)}
      >${
        picture
          ? html`<img src=${picture} alt="" />`
          : html`<span>${fallbackInitial || ""}</span>`
      }</span
    >`;
  }

  _entityColor(entityId, stateObj) {
    if (computeDomain(entityId) === "zone") {
      return zoneColor(
        entityId,
        !!stateObj?.attributes.passive,
        this._registryEntries(),
        getComputedStyle(this)
      );
    }
    return entityMapColor(entityId, this._registryEntries(), getComputedStyle(this));
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

  _formatState(stateObj, overrideState) {
    try {
      if (this.hass?.formatEntityState) {
        return this.hass.formatEntityState(stateObj, overrideState);
      }
    } catch {
      /* fallback */
    }
    if (overrideState) {
      return overrideState;
    }
    if (computeDomain(stateObj.entity_id) === "zone") {
      return `${stateObj.state} 人`;
    }
    const state = stateObj.state;
    const pretty = {
      home: "在家",
      not_home: "离家",
      unavailable: "不可用",
      unknown: "未知",
    };
    return pretty[state] || state;
  }

  _handleTabClick(ev) {
    this._fireTab(ev.currentTarget.dataset.tab);
  }

  _fireTab(tab) {
    this.dispatchEvent(
      new CustomEvent("map-overview-tab", { detail: { tab }, bubbles: true, composed: true })
    );
  }

  _handleItemClick(ev) {
    this._fireSelect(ev.currentTarget.dataset.entityId);
  }

  _handleBack() {
    this._fireSelect(undefined);
  }

  _fireSelect(entityId) {
    this.dispatchEvent(
      new CustomEvent("map-overview-select", {
        detail: entityId ? { entityId } : {},
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("map-cn-overview", MapCnOverview);

// 导出活动时间线逻辑供单测/复用（对齐官方 map-activity.ts 结构）
export { personActivity, zoneActivity };
