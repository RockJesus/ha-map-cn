// 官方地图调色板逻辑复刻：实体颜色按注册表顺序取主题色板 --color-N；
// zone.home 固定主色、passive zone 弱化色；未注册实体按 id 哈希取色。

export const HOME_ZONE_ENTITY_ID = "zone.home";
export const COLORS_COUNT = 54;

const computeDomain = (entityId) =>
  entityId.split(".")[0];

export const getColorByIndex = (index, computedStyles) => {
  const colorIndex = ((index % COLORS_COUNT) + COLORS_COUNT) % COLORS_COUNT + 1;
  return computedStyles.getPropertyValue(`--color-${colorIndex}`);
};

const byCreation = (a, b) => {
  const ac = a.created_at ?? 0;
  const bc = b.created_at ?? 0;
  return ac - bc || (a.id || "").localeCompare(b.id || "");
};

const domainEntries = (entries, domain) =>
  entries
    .filter((entry) => computeDomain(entry.entity_id) === domain)
    .sort(byCreation);

const paletteIndex = (entries) => {
  const zones = domainEntries(entries, "zone").filter(
    (entry) => entry.entity_id !== HOME_ZONE_ENTITY_ID
  );
  const personsAndTrackers = [
    ...domainEntries(entries, "person"),
    ...domainEntries(entries, "device_tracker"),
  ];
  const byEntityId = {};
  [zones, personsAndTrackers].forEach((sequence) =>
    sequence.forEach((entry, i) => {
      byEntityId[entry.entity_id] = i;
    })
  );
  return { byEntityId, zoneCount: zones.length };
};

const hashIndex = (entityId) => {
  let hash = 5381;
  for (let i = 0; i < entityId.length; i++) {
    hash = (hash * 33 + entityId.charCodeAt(i)) % 2147483647;
  }
  return hash;
};

/** 实体在地图上的颜色（按注册表顺序的色板） */
export const entityMapColor = (entityId, entries, computedStyles) =>
  getColorByIndex(
    paletteIndex(entries).byEntityId[entityId] ?? hashIndex(entityId),
    computedStyles
  );

/** zone 颜色：home 主色、passive 弱化色、其余按色板 */
export const zoneColor = (entityId, passive, entries, computedStyles) => {
  if (entityId === HOME_ZONE_ENTITY_ID) {
    return computedStyles.getPropertyValue("--primary-color");
  }
  if (passive) {
    return computedStyles.getPropertyValue("--secondary-text-color");
  }
  return entityMapColor(entityId, entries, computedStyles);
};

/** 默认实体图标（label_mode=icon / zone 无自定义 icon 时兜底） */
export const defaultIconForDomain = (entityId) => {
  switch (computeDomain(entityId)) {
    case "person":
      return "mdi:account";
    case "device_tracker":
      return "mdi:crosshairs-gps";
    case "zone":
      return "mdi:map-marker";
    case "geo_location":
      return "mdi:map-marker-radius";
    default:
      return "mdi:map-marker";
  }
};
