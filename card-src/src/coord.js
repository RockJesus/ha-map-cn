// WGS-84 <-> GCJ-02 coordinate conversion (标准火星坐标转换算法, eviltransform 经典实现)
// 高德/腾讯底图使用 GCJ-02；HA 实体坐标为 WGS-84；天地图/OSM 使用 WGS-84（CGCS2000 与 WGS-84 差异亚米级，显示无需转换）

const A = 6378245.0;
const EE = 0.00669342162296594323;

export const outOfChina = (lng, lat) =>
  !(72.004 <= lng && lng <= 137.8347 && 0.8293 <= lat && lat <= 55.8271);

const transLat = (x, y) => {
  let r =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  r +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) +
      20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  r +=
    ((20.0 * Math.sin(y * Math.PI) +
      40.0 * Math.sin((y / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  r +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) +
      320.0 * Math.sin((y * Math.PI) / 30.0)) *
      2.0) /
    3.0;
  return r;
};

const transLng = (x, y) => {
  let r =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  r +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) +
      20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  r +=
    ((20.0 * Math.sin(x * Math.PI) +
      40.0 * Math.sin((x / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  r +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) +
      300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0;
  return r;
};

/** WGS-84 -> GCJ-02 */
export const wgs84ToGcj02 = (lng, lat) => {
  if (outOfChina(lng, lat)) {
    return [lng, lat];
  }
  let dLat = transLat(lng - 105.0, lat - 35.0);
  let dLng = transLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat =
    (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
};

/** GCJ-02 -> WGS-84 (近似逆变换，官方与各家实现一致) */
export const gcj02ToWgs84 = (lng, lat) => {
  if (outOfChina(lng, lat)) {
    return [lng, lat];
  }
  const [mLng, mLat] = wgs84ToGcj02(lng, lat);
  return [lng * 2 - mLng, lat * 2 - mLat];
};

/** 依 provider 坐标系把 WGS-84 坐标转为地图坐标 */
export const toMapCoords = (lat, lng, coordinateSystem) =>
  coordinateSystem === "gcj02" ? wgs84ToGcj02(lng, lat) : [lng, lat];

/** 依 provider 坐标系把地图坐标转回 WGS-84 */
export const fromMapCoords = (lng, lat, coordinateSystem) =>
  coordinateSystem === "gcj02" ? gcj02ToWgs84(lng, lat) : [lng, lat];
