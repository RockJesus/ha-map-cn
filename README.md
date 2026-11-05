# ha-map-cn · 中国地图卡片

> Home Assistant 地图卡片，国内底图直连。
> **不改 HA 源码、不装代理、不需要服务器能翻墙**——瓦片由浏览器直接加载。

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)

## 安装（HACS，资源自动添加）

1. HACS → 右上角 ⋮ → **自定义存储库**
2. 填 `https://github.com/RockJesus/ha-map-cn`，类别选 **Lovelace / Dashboard**
3. 搜索安装 → **重启 HA**（或刷新浏览器）
4. **资源会自动注册**，无需手动添加

> 自动注册依赖仓库根目录的 `hacs.json` 里 `"filename": "ha-cn-map-card.js"`。
> 如果 HACS 版本较旧没自动加，手动加一条：`/hacsfiles/ha-map-cn/ha-cn-map-card.js`，类型 **JavaScript Module**。

### 更新后看不到新功能？

**HACS 安装（绝大多数人）：什么都不用做。** HACS ≥ 2.0 在每次升级后会自动把资源 URL 改写成
`?hacstag=<仓库ID><版本号>`（可在 设置 → 仪表盘 → 资源 里看到），版本一变 URL 就变，
浏览器缓存自动失效。手动改这条 URL 没有必要——下次升级 HACS 会照旧覆写。

**手动安装：** 浏览器会缓存旧 JS，升级后给资源 URL 加版本参数强制刷新：

```
/local/ha-cn-map-card.js?v=080
```

每升一版把 `080` 递增即可（如 `090`）。

### 手动安装（不用 HACS）

下载 `ha-cn-map-card.js` 放到 `/config/www/`，资源里加 `/local/ha-cn-map-card.js`，类型选 **JavaScript Module**。

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

把仓库根目录的 `ha-cn-map-card.js` 放到 `/config/www/`，然后资源里加 `/local/ha-cn-map-card.js`（类型 JavaScript Module）。

---

## 配置

### 图形界面（推荐）

在仪表盘编辑模式下点卡片的「编辑」，弹出的是**完整可视化编辑器**，无需写 YAML：

| 表单区域 | 可设置 |
|---|---|
| 标题 | 卡片顶部标题，留空则不显示标题栏 |
| 底图来源 | 高德 / 高德卫星 / 天地图 / 天地图卫星 / OSM（下拉选择） |
| 天地图 Key | **仅当选天地图时出现**，自动联动 |
| 显示哪些标记 | 自动显示全部 / 显示区域 / 首次自动缩放（三个开关） |
| 指定实体 | 选 domain 过滤 → 下拉选实体 → 点「添加」；已添加的显示为标签可逐个删除。**关掉「自动显示全部」时才出现** |
| 默认缩放级别 | 关掉「首次自动缩放」时生效 |
| 卡片高度 | 像素值，改完预览实时变化 |

所有改动即时通过 `config-changed` 回传，点「保存」才落盘。

### YAML

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

show_cluster: true           # 标记聚合（默认开）；相近标记合并成气泡
show_labels: true            # 标记下方显示名称
persist: true                # 允许抽屉改动存到浏览器；false = 只在本次浏览有效
fit_entities: true           # 首次自动缩放到所有实体
default_zoom: 12             # fit_entities: false 时生效

hours_to_show: 0             # >0 时绘制轨迹线（0=关闭，24=最近24小时）
track_width: 3               # 轨迹线宽
track_opacity: 0.85          # 轨迹不透明度
show_traffic: false          # 高德实时路况叠加（仅 amap 底图）
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

## 轨迹线

设置 `hours_to_show: 24`（或任意小时数）即可在地图上画出实体的历史轨迹：

- 通过 WebSocket `history/stream` 订阅，数据实时推送，不用反复轮询 REST
- 每个实体按颜色区分，颜色优先取卡片配置里的 `color`，其次实体属性，最后默认蓝
- 高德底图下轨迹点自动做 GCJ-02 纠偏，**和标记一样不会偏移**
- 轨迹超出视口时由 SVG 裁剪，不会画出跨省直线
- 卡片从仪表盘移除时自动取消订阅，不留后台连接

> 前提：实体有历史记录。刚装的 HA 或刚接入的设备需要等一段时间才有数据。

## 实时路况

`show_traffic: true` 会在高德底图上叠加实时路况瓦片（红黄绿线），或点卡片左上角 🚦 一键开关。

- **仅支持 `amap` / `amap-satellite`**：路况瓦片和底图必须同一坐标系
- 天地图/OSM 下该按钮无效，避免错位

## 标记聚合

相近的标记会自动合并成一个气泡，避免 8 个设备叠在同一个点上只见最上面那个。

| | 关闭聚合 | 开启聚合 |
|---|---|---|
| 效果 | ![off](examples/cluster-off.png) | ![on](examples/cluster-on.png) |

- 屏幕上 **60px 内**的标记归为一组，气泡最多 3 个头像（边框用实体配色），超出显示 `+N`
- **点击气泡**以点击位置为锚点放大两级，成员就地拆开
- `zone.*`（家 / 公司）不参与聚合，永远单独显示
- 关掉：抽屉里取消「标记聚合」，或 YAML 写 `show_cluster: false`

## 卡片内设置抽屉

点卡片左上角 ⚙ 打开右侧抽屉，不用进编辑模式就能改：底图、天地图 Key、实时路况、轨迹时长、显示区域、**标记聚合**、**显示名称**。

改动即时生效，并**自动保存在浏览器本地**（`localStorage`）——刷新页面、切到别的视图再回来都还在。

| 行为 | 说明 |
|---|---|
| 存储位置 | 浏览器 `localStorage`，键名 `ha-cn-map-card:<仪表盘路径>#v<视图>c<卡片序号>` |
| 生效范围 | 仅当前浏览器，不同步到服务器、不影响其他设备 |
| 与 YAML 的优先级 | 本地保存的值覆盖 YAML 里的同名键 |
| 一键还原 | 抽屉底部「恢复默认」→ 清除本地记录，回到 YAML 配置 |
| 关闭持久化 | 卡片配置里加 `persist: false`，抽屉改动就只在本次浏览有效 |

> 为什么不用 HA 自己的保存？卡片点击 ⚙ 属于浏览态操作，直接写仪表盘配置要触发 `config-changed` 并由编辑模式接管，普通视图下点了会把整张仪表盘切进编辑态。用 `localStorage` 既能"记住我的选择"，又不会动到 `/config/.storage`。

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

**标记图标为什么是方块/放大镜？**
卡片按实体域给默认图标：`person.*` → 人像，`device_tracker.*` → 手机，其余 → 定位针。若实体自带 `icon` 属性会优先用它的。方块说明 HA 前端没加载出 MDI 图标字体，刷新页面即可。

**左下角比例尺会跟着缩放变吗？**
会。按当前纬度的墨卡托比例实时换算，自动取 1/2/5 × 10^n 的整齐距离。

**左上角第三个按钮是什么？**
「显示全部」——把视野重新适配到所有标记，拖动/缩放跑偏后一键复位。

**性能和官方比如何？**
纯 DOM + img 瓦片，无 WebGL。中低端手机反而比官方的 MapLibre 更流畅，但没有 3D 和矢量缩放平滑度。

---

## 开发

```bash
# 本地预览：起个静态服务器，打开仓库里的示例页
python3 -m http.server 8931
# http://localhost:8931/examples/card.html   卡片预览（mock hass）
# http://localhost:8931/examples/editor.html 可视化编辑器
# http://localhost:8931/examples/features.html 轨迹/路况/设置抽屉
# http://localhost:8931/examples/cluster.html  标记聚合
```

文件结构：

```
ha-cn-map-card.js       # 全部代码，单文件，零依赖，约 50KB
hacs.json               # HACS 元数据（filename 指向根目录的 js）
examples/               # 本地预览页（含 mock hass 与模拟历史数据）
  card.html
  editor.html
  features.html
  example.yaml          # 配置示例
.github/workflows/      # HACS 校验
```

---

## 版本历史

- **v0.8.0**：新增**标记聚合**（相近标记合并成气泡，最多 3 个头像 + `+N`，点击放大拆开；家/区域不参与聚合）；新增**设置本地持久化**（抽屉改动写入 `localStorage`，刷新仍生效，可一键恢复默认）；新增「显示名称」开关；修复 `fitBounds` 在两枚标记重合时把缩放解到 18 级"贴脸"的问题（按卡片宽度封顶）；修复复选框关闭状态保存不进去、以及重置按钮误触发页面导航
- **v0.7.0**：合并旧 map-cn 的核心能力——**轨迹线**（history/stream 订阅）、**实时路况叠加**、**卡片内设置抽屉**；修复 SVG 图层尺寸导致的轨迹不显示
- **v0.6.0**：新增完整可视化编辑器（无需 YAML）；新增比例尺；新增「显示全部」复位按钮；标记图标按实体域区分（person/device_tracker/其他）
- **v0.1.0**：首个版本，高德/天地图底图、GCJ-02 自动纠偏、标记与区域显示

## 已知限制

1. **单文件无构建**：代码未压缩，约 30KB。要发布 HACS 建议后续接 esbuild。
2. **聚合为屏幕像素贪心算法**：不做层级金字塔，缩放到不同级别时每次重算；实体过千会有明显卡顿（DOM 标记方案的天花板）。
3. **轨迹无方向箭头**：只画线，不标行进方向。
4. **瓦片无本地缓存**：依赖浏览器 HTTP 缓存。
5. **高德瓦片非官方 API**：用的是 `webrd0x.is.autonavi.com` 公开瓦片端点，无 SLA 保证。生产环境建议换天地图（有正式 Key 和配额）。

## License

MIT
