// 底图供应商配置：瓦片 URL 模板（MapLibre raster source）、样式矩阵、坐标系
// 注意：高德/腾讯使用 GCJ-02 坐标系（实体坐标需 wgs84->gcj02 转换后显示）；
// 天地图使用 CGCS2000（≈WGS-84）；OSM 使用 WGS-84。

const subdomains = (prefix, count, suffix) =>
  Array.from({ length: count }, (_, i) => prefix + (i + 1) + suffix);

const amapStyle = (style) =>
  subdomains("https://webrd0", 4, ".is.autonavi.com/appmaptile").map(
    (host) =>
      `${host}?lang=zh_cn&size=1&scale=1&style=${style}&x={x}&y={y}&z={z}`
  );

const amapSatellite = subdomains(
  "https://webst0",
  4,
  ".is.autonavi.com/appmaptile"
).map((host) => `${host}?style=6&x={x}&y={y}&z={z}`);

// 高德实时路况（透明 PNG 叠加层，GCJ-02 坐标系，随高德底图一起使用）
const amapTraffic = [
  "https://tm.amap.com/trafficengine/mapabc/traffictile?v=1.0&t=1&x={x}&y={y}&z={z}",
];

// 腾讯地图瓦片 y 轴为 TMS（从南到北），需在 transformRequest 里做 y' = 2^z - 1 - y 反转
// （见 map-cn-card.js transformRequest）；URL 模板里 {y} 是 MapLibre 的 XYZ 值，仅作占位。
const tencentTiles = (styleid) =>
  subdomains("https://rt", 4, ".map.gtimg.com/tile").map(
    (host) => `${host}?z={z}&x={x}&y={y}&styleid=${styleid}`
  );

const tiandituTiles = (layer, key) =>
  Array.from(
    { length: 8 },
    (_, i) =>
      `https://t${i}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${key}`
  );

export const TILE_PROVIDERS = {
  gaode: {
    name: "高德地图",
    coordinateSystem: "gcj02",
    attribution:
      '&copy; <a href="https://www.amap.com" target="_blank" rel="noopener">高德地图</a>',
    styles: {
      normal: { urls: amapStyle(7), maxzoom: 18 },
      light: { urls: amapStyle(7), maxzoom: 18 },
      satellite: { urls: amapSatellite, maxzoom: 18 },
      dark: { urls: amapStyle(7), maxzoom: 18, darkFilter: true },
    },
    // 高德实时路况叠加层（透明瓦片，provider=gaode 且 show_traffic 时启用）
    traffic: { urls: amapTraffic, maxzoom: 18 },
  },
  tencent: {
    name: "腾讯地图",
    coordinateSystem: "gcj02",
    attribution:
      '&copy; <a href="https://lbs.qq.com" target="_blank" rel="noopener">腾讯地图</a>',
    // 腾讯瓦片 styleid 语义（实测）：0=标准(白底)、1=标准(浅灰底)、4=深色夜景；
    // styleid=2 为透明层（无底图）。腾讯卫星图无公开瓦片 URL（官方 SATELLITE 走自定义
    // ImageMapType），故腾讯不提供 satellite 样式。
    styles: {
      normal: { urls: tencentTiles(0), maxzoom: 20 },
      light: { urls: tencentTiles(1), maxzoom: 20 },
      // darkTile: 瓦片本身已是深色，卡片暗色模式不再反相（仅微调亮度）
      dark: { urls: tencentTiles(4), maxzoom: 20, darkTile: true },
    },
  },
  tianditu: {
    name: "天地图",
    coordinateSystem: "wgs84",
    requiresKey: true,
    attribution:
      '&copy; <a href="https://www.tianditu.gov.cn" target="_blank" rel="noopener">天地图</a>',
    styles: {
      normal: {
        urls: (key) => tiandituTiles("vec", key),
        maxzoom: 18,
        labelUrls: (key) => tiandituTiles("cva", key),
      },
      satellite: {
        urls: (key) => tiandituTiles("img", key),
        maxzoom: 18,
        labelUrls: (key) => tiandituTiles("cva", key),
      },
      light: {
        urls: (key) => tiandituTiles("vec", key),
        maxzoom: 18,
        labelUrls: (key) => tiandituTiles("cva", key),
      },
      dark: {
        urls: (key) => tiandituTiles("vec", key),
        maxzoom: 18,
        labelUrls: (key) => tiandituTiles("cva", key),
        darkFilter: true,
      },
    },
  },
  osm: {
    name: "OpenStreetMap",
    coordinateSystem: "wgs84",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    styles: {
      normal: {
        urls: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        maxzoom: 19,
      },
      light: {
        urls: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        maxzoom: 19,
      },
      dark: {
        urls: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        maxzoom: 19,
        darkFilter: true,
      },
      satellite: {
        urls: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        maxzoom: 19,
      },
    },
  },
};

export const DEFAULT_PROVIDER = "gaode";
export const DEFAULT_STYLE = "normal";
