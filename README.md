# 中国地图卡片（China Map Card）

[![HACS](https://img.shields.io/badge/HACS-自定义集成-41BDF5.svg)](https://github.com/hacs/integration)
[![版本](https://img.shields.io/badge/版本-v0.2.4-blue.svg)](https://github.com/RockJesus/ha-map-cn/releases)
[![HA 最低版本](https://img.shields.io/badge/HA-2024.1-orange.svg)]()

Home Assistant 官方地图卡片在中国刷不出底图的替代方案——**功能与官方地图卡片一致，底图使用国内可达的高德 / 腾讯 / 天地图瓦片**。

## 为什么需要它

HA 新版（2024.12+）地图卡片基于 MapLibre 渲染，底图瓦片全部经 HA core 内置 `map_tiles` 组件代理回源到 OpenStreetMap 服务器。在国内该回源不可达，地图显示为空白。

本卡片内置国内瓦片源，**无需修改任何官方文件、无需科学上网**，装完即用。

## 特性

- **功能与官方 `map` 卡片一致**：
  - `entities`（person / device_tracker / zone），支持自定义颜色、label 模式（name / state / attribute / icon）
  - `show_all`、`geo_location_sources`（含 label/attribute/unit/focus）
  - `auto_fit`、`fit_zones`、`show_zone_radius`、`default_zoom`
  - `hours_to_show` 历史轨迹
  - `dark_mode` / `theme_mode` 深浅色（深色自动滤镜）
  - `cluster` 标记聚合（可切换聚合/展开）
  - `conditions` 条件显示、`scale_ruler` 比例尺、`aspect_ratio`、`title`
  - zone 半径圈、GPS 精度圈、标记点击弹出详情
- **概述 Tab（与官方 Map 仪表盘一致）**：Panel 布局下卡片顶部自动提供 **人 / 设备 / 区域** 三个切换 Tab（官方 People/Devices/Zones），按类过滤实体
- **国内底图**：高德（默认）/ 腾讯 / 天地图 / OSM，样式含标准、浅色、卫星、深色
- **坐标自动转换**：高德/腾讯（GCJ-02）自动把 WGS-84 实体坐标做火星坐标转换，位置不偏移；天地图/OSM 无需转换
- **零外部依赖**：卡片为单文件自包含（已内置渲染引擎），国内无需任何 CDN
- **安装即自动注册仪表盘资源**：集成安装后自动把卡片 JS（`/ha-map-cn/map-cn.js`）注入仪表盘，**无需手动添加资源**，刷新即用
- **全程 UI 配置**：添加卡片后所有选项（实体/颜色/底图/样式/轨迹/聚合/比例尺等）都在界面里可视化设置，**不需要写任何 YAML**

## 快速开始（纯 UI，不需要写代码）

1. **安装**：HACS → 右上角 ⋮ → 自定义存储库 → 添加 `https://github.com/RockJesus/ha-map-cn`（类别选 **集成**）→ 下载 → **重启 Home Assistant**
2. **刷新浏览器**（Ctrl+F5）——卡片资源已自动注册，无需任何手动配置
3. **创建仪表盘**：设置 → 仪表盘 → **添加仪表盘** → 输入名称（如"地图"）→ 创建（任意类型均可）
4. **添加卡片**：打开新仪表盘 → 右上角「编辑」→ **添加卡片** → 搜索 **地图** → 选择 **中国地图卡片**
5. **UI 可视化设置**（全程界面操作，无代码）：
   - **底图**：供应商下拉（高德/腾讯/天地图/OSM）+ 样式下拉（标准/浅色/卫星/深色）
   - **实体**：逐行「添加实体」选择器选择 person / device_tracker / zone，每行可设颜色、标签模式
   - **其他**：标题、默认缩放、轨迹小时数、显示全部实体、自动视野、区域半径、聚合、比例尺、深浅色 等开关/输入框
6. **完成**：保存即可看到中国版地图；仪表盘以整页显示（Panel）时，地图顶部自动出现 **人 / 设备 / 区域** 切换

> 整个流程**不需要编辑任何 YAML / configuration.yaml 文件**。如需更多设置项，请见下方「全部配置项」。

## 安装

> 安装后**自动注册仪表盘资源**（JS 由集成提供，URL 固定为 `/ha-map-cn/map-cn.js`），无需手动添加资源。

### HACS（推荐）

1. HACS → 右上角 ⋮ → **自定义存储库** → 添加 `https://github.com/RockJesus/ha-map-cn`，类别选 **集成**
2. 下载并**重启 Home Assistant**
3. 刷新浏览器（Ctrl+F5）——卡片资源已自动注册，按上面「快速开始」添加卡片即可

### 手动安装

1. 从 [Releases](https://github.com/RockJesus/ha-map-cn/releases) 下载 `map-cn.js`（v0.2.1 起发布物为单文件 js）
2. 把 `map-cn.js` 放到 HA 配置目录的 `www/ha-map-cn/` 下（即 `/config/www/ha-map-cn/map-cn.js`）
3. **设置 → 仪表盘 → 右上角 ⋮ → 资源** → 添加资源：
   - URL：`/local/ha-map-cn/map-cn.js`
   - 类型：**JavaScript 模块**
4. 刷新浏览器（Ctrl+F5）

## 使用

添加卡片时选择**中国地图卡片**，所有设置项均为可视化控件（实体选择器、下拉、开关、输入框），保存即生效。

<details>
<summary>（可选）直接编辑 YAML 的高级用法</summary>

```yaml
type: map-cn
provider: gaode          # gaode | tencent | tianditu | osm，默认 gaode
style: normal            # normal | light | satellite | dark，默认 normal
tianditu_key: ""         # 仅 provider: tianditu 需要（www.tianditu.gov.cn 免费申请）
auto_fit: true           # 自动缩放到所有实体
entities:
  - person.zhang_san
  - entity: person.li_si
    color: "#ff0000"
hours_to_show: 24        # 显示 24 小时历史轨迹
theme_mode: auto         # auto | light | dark
cluster: true            # 标记聚合
scale_ruler: true
title: 家人位置
```

</details>

## （可选）YAML 仪表盘模板

> 不想写代码就用「快速开始」的 UI 方式创建仪表盘，**无需本小节**。本小节仅适合偏好 YAML 的用户。

仓库内置 `dashboards/map-cn.yaml`（Panel 视图 + 地图卡片，卡片顶部带 人/设备/区域 Tab），按 HA 官方仪表盘规范使用：

1. 先安装本卡片（HACS 集成 或 手动资源）
2. 把 `dashboards/map-cn.yaml` 复制到 `/config/map-cn.yaml`
3. 在 `configuration.yaml` 追加：

```yaml
lovelace:
  mode: storage
  dashboards:
    map-cn:
      mode: yaml
      title: 中国地图
      icon: mdi:map
      show_in_sidebar: true
      filename: map-cn.yaml
```

4. 重启 Home Assistant（或「仪表盘 → ⋮ → 重新加载资源」）
5. 侧边栏出现**中国地图**仪表盘，地图顶部可直接切换 人/设备/区域

### 全部配置项

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `provider` | string | `gaode` | 底图供应商：`gaode` / `tencent` / `tianditu` / `osm` |
| `style` | string | `normal` | 地图样式：`normal` / `light` / `satellite` / `dark` |
| `tianditu_key` | string | 空 | `tianditu` 必须填写（免费申请） |
| `coordinate_system` | string | `auto` | `auto`（按供应商）/ `wgs84` / `gcj02`，实体坐标已是中国坐标时用 `gcj02` |
| `entities` | list | - | 实体列表，字符串或对象（支持 `color` / `label_mode` / `attribute` / `unit` / `focus` / `name`） |
| `show_all` | boolean | false | 显示全部有位置的实体（与 entities 二选一） |
| `geo_location_sources` | list | - | geo_location 来源，字符串或对象（`source` / `label_mode` / `attribute` / `unit` / `focus`） |
| `auto_fit` | boolean | false | 自动缩放视野到所有实体 |
| `fit_zones` | boolean | false | 自动缩放时包含 zone |
| `show_zone_radius` | boolean | true | 显示 zone 半径圈 |
| `default_zoom` | number | 14 | 无自动缩放时的初始缩放 |
| `hours_to_show` | number | 0 | 显示多少小时的历史轨迹（0 关闭） |
| `dark_mode` | boolean | false | 强制深色（旧配置项） |
| `theme_mode` | string | `auto` | `auto` / `light` / `dark` |
| `cluster` | boolean | true | 标记聚合 |
| `conditions` | list | - | 条件显示（与官方一致：state / numeric_state / and / or / not / time / user / screen / location） |
| `scale_ruler` | boolean | false | 显示比例尺 |
| `aspect_ratio` | string | 1:1 | 卡片宽高比，如 `16/9` |
| `title` | string | - | 卡片标题 |

## 底图供应商

| 供应商 | 坐标系 | 样式 | 是否需要 Key | 说明 |
|---|---|---|---|---|
| 高德 | GCJ-02 | 标准 / 浅色 / 卫星 / 深色 | 否 | 默认推荐，瓦片国内直连 |
| 腾讯 | GCJ-02 | 标准 / 浅色 / 卫星 / 深色 | 否 | |
| 天地图 | CGCS2000（≈WGS-84） | 标准 / 卫星（含注记） | 是 | 国家地理信息公共服务平台，[免费申请](https://www.tianditu.gov.cn) |
| OSM | WGS-84 | 标准 | 否 | 官方同源，国内一般不可达，备用 |

> 坐标说明：HA 实体（GPS）坐标是 WGS-84；高德/腾讯底图使用 GCJ-02（火星坐标）。本卡片自动将实体坐标转换到底图坐标系显示，位置无偏移。若你的实体坐标本身就是 GCJ-02（如部分国内定位设备上报），可设 `coordinate_system: gcj02` 关闭转换。

## 常见问题

**地图空白？**
- 确认已重启 HA 并硬刷新浏览器（Ctrl+F5）
- 确认网络可访问 `webrd01.is.autonavi.com`（高德）/ `rt1.map.gtimg.com`（腾讯）/ `t0.tianditu.gov.cn`（天地图）
- 天地图未填 `tianditu_key` 时卡片会显示错误提示

**标记位置有偏移？**
- 默认 `coordinate_system: auto` 已按供应商自动转换，若实体坐标本就是 GCJ-02，请设 `coordinate_system: gcj02`

**和官方地图卡片有什么区别？**
- 底图换为国内瓦片源，其余功能（实体/轨迹/聚合/区域/条件/深浅色/概述 Tab）与官方一致

## 隐私

- 底图瓦片请求仅包含地图瓦片坐标，**不包含任何实体数据**
- 实体位置数据只在浏览器本地渲染，不上传任何第三方

## 版本历史

<details>
<summary>v0.2.4（最新）</summary>

- 文档重排：新增「快速开始（纯 UI）」——全程界面操作（仪表盘 UI 创建 + 卡片 UI 可视化设置），无需写任何 YAML；YAML 方式降级为可选
</details>
<details>
<summary>v0.2.3</summary>

- 概述 Tab：卡片实现官方 People/Devices/Zones 一致的 **人 / 设备 / 区域** 切换（Panel 布局自动显示、按类过滤实体）
- 仪表盘模板：新增 `dashboards/map-cn.yaml`（按 HA 官方仪表盘规范，Panel 视图 + 地图卡片 + 概述 Tab）
</details>
<details>
<summary>v0.2.2</summary>

- 形态回归：轻量集成（custom_components/map_cn）——安装即**自动注册仪表盘资源**（`/ha-map-cn/map-cn.js`），无需手动添加资源；JS 目录/URL 统一使用 `ha-map-cn`
</details>
<details>
<summary>v0.2.1</summary>

- 发布物形态：Releases 的下载产物由 zip 包改为**单个 `map-cn.js` 文件**——手动下载即得 js（无需解压），HACS 前端类别下载同样直接取 js
</details>
<details>
<summary>v0.2.0</summary>

- 形态变更：从 HACS 集成（custom_components）改为**前端资源（Frontend plugin）**——纯仪表盘资源加载，无需安装集成、无需重启 HA；安装方式见上文
</details>
<details>
<summary>v0.1.1</summary>

- UI 可视化编辑器：实体逐行选择（ha-entity-picker，支持自定义颜色）、底图/样式/主题/轨迹/聚合/比例尺等全部选项可视化配置
- 修复：编辑器模块未随单文件产物内联（动态 import 在单文件方案下运行时 404）
</details>
<details>
<summary>v0.1.0</summary>

- 首个版本：中国版地图卡片，支持高德/腾讯/天地图/OSM 底图、官方地图卡片全部核心功能、WGS-84/GCJ-02 坐标自动转换
</details>
