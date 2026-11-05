# ha-cn-map-card

> Home Assistant 地图卡片 · 国内底图直连版。
> **不改 HA 源码、不装代理、不需要服务器能访问外网**——卡片直接从浏览器加载高德/天地图瓦片。

[![hacs](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)

---

## 为什么需要它

HA 2026.9 起，官方地图改用 OSMF 矢量瓦片，且**瓦片请求由 HA 服务器发出**。国内服务器的出口访问不到 `vector.openstreetmap.org`，所以官方 `type: map` 卡片在全国范围都是纯色底——手机挂代理也没用，因为请求根本不经过手机。

这个卡片把底图换成**浏览器直连**的国内瓦片服务，绕开服务器出口问题。

| | 官方 `type: map` | 本卡片 |
|---|---|---|
| 底图来源 | OSMF 矢量瓦片 | 高德 / 天地图 |
| 请求发起方 | HA 服务器 | 你的浏览器 |
| 国内可用 | 否（除非服务器能翻墙） | **是** |
| 需要改 HA 源码 | — | 否 |
| 安装方式 | 内置 | HACS / 手动放一个 js |
| 标记偏移 | 无 | 高德自动 GCJ-02 纠偏 |

---

## 安装

### HACS（推荐）

1. HACS → 前端 → 右上角 ⋮ → **自定义存储库**
2. 填仓库地址，类别选 **Lovelace / Dashboard**
3. 搜 `ha-cn-map-card` 安装 → 刷新页面
4. 若没自动注册资源，手动加：设置 → 仪表盘 → ⋮ → 资源 → 添加
   `/hacsfiles/ha-cn-map-card/ha-cn-map-card.js`，类型 **JavaScript Module**

### 手动

把 `dist/ha-cn-map-card.js` 放到 `/config/www/`，然后同上添加资源 `/local/ha-cn-map-card.js`。

---

## 配置

最小可用：

```yaml
type: custom:ha-cn-map-card
show_all: true
```

完整字段：

```yaml
type: custom:ha-cn-map-card
title: 家人位置               # 可选，显示顶部标题栏
height: 400                  # 卡片高度（px），默认 360

basemap: amap                # amap(默认) | amap-satellite | tianditu | tianditu-satellite | osm
tianditu_key: ""             # 用天地图时必填

entities:                    # 指定实体；不填则配合 show_all
  - person.me
  - device_tracker.car
show_all: false              # true = 自动列出所有 person./device_tracker./geo_location.
show_zones: false            # true = 显示 zone.* 区域图标
geo_location_sources: []     # 按 source 过滤 geo_location 实体

fit_entities: true           # 首次自动缩放到所有实体
default_zoom: 12             # fit_entities: false 时生效
```

### 底图对比

| basemap | 需要 Key | 最大级别 | 偏移处理 | 说明 |
|---|---|---|---|---|
| `amap` | 否 | 18 | 自动 GCJ-02 纠偏 | **默认**，免申请，国内速度最快 |
| `amap-satellite` | 否 | 18 | 同上 | 高德卫星影像 + 路网标注 |
| `tianditu` | **是** | 18 | 无需（CGCS2000≈WGS84） | 国家天地图矢量 + 中文注记，合规性最好 |
| `tianditu-satellite` | **是** | 18 | 无需 | 天地图影像 + 注记 |
| `osm` | 否 | 19 | 无需 | 海外或能翻墙时用 |

天地图 Key 免费申请：<https://console.tianditu.gov.cn/> → 创建应用 → 选「浏览器端」→ 复制 tk。免费额度约 1 万次/天。

---

## 关于坐标偏移（重要）

HA 里的实体坐标是 **WGS84**。高德底图使用 **GCJ-02**，两者在国内相差 **300~600 米**（北京约 556 米，方向东北）。

本卡片在 `basemap: amap*` 时，会自动把标记坐标做 WGS84 → GCJ-02 转换，所以标记会精确落在高德底图的对应建筑上。天地图用 CGCS2000，与 WGS84 差异在米级，不需要转换。

> 已实测：天安门 WGS84 (39.9087, 116.3975) 纠偏为 GCJ-02 (39.910103, 116.403744)，偏移 556 米，方向东北——与标准 GCJ-02 特性一致。

---

## 常见问题

**底图还是不出来？**
F12 打开开发者工具 → Network，看 `autonavi.com` 或 `tianditu.gov.cn` 的请求。若返回 4xx/被拦截，检查浏览器插件（广告拦截器可能误杀瓦片域名）。

**标记位置偏了几百米？**
说明 `basemap` 是高德但 `needsShift` 没生效，或你自己在实体里存的就是 GCJ-02 坐标（部分国产 GPS 设备直接输出 GCJ-02）。后者请把 `basemap` 改成 `amap` 之外的值，或提 issue。

**天地图返回 418？**
Key 无效或未开通「浏览器端」类型。到控制台检查应用类型。

**能显示轨迹吗？**
当前版本只显示当前位置标记，不含历史轨迹线。轨迹需要按 `hours_to_show` 请求历史 API，在开发计划里。

**性能和官方比如何？**
纯 DOM + img 瓦片，无 WebGL。中低端手机反而比官方的 MapLibre 更流畅，但没有 3D 和矢量缩放平滑度。

---

## 开发

```bash
# 本地预览（模拟 HA 环境）
cd test && python3 -m http.server 8931
# 浏览器打开 http://localhost:8931/test.html
```

文件结构：

```
dist/ha-cn-map-card.js   # 全部代码，单文件，零依赖
test/test.html           # 本地预览页（含 mock hass）
hacs.json                # HACS 元数据
```

---

## 已知限制

1. **单文件无构建**：代码未压缩，约 30KB。要发布 HACS 建议后续接 esbuild。
2. **无轨迹线**：只有当前位置。
3. **无聚合**：实体多时标记会重叠。
4. **瓦片无本地缓存**：依赖浏览器 HTTP 缓存。
5. **高德瓦片非官方 API**：用的是 `webrd0x.is.autonavi.com` 公开瓦片端点，无 SLA 保证。生产环境建议换天地图（有正式 Key 和配额）。

## License

MIT
