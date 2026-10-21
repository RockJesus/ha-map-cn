# 中国地图仪表盘（China Map Dashboard）

[![HACS](https://img.shields.io/badge/HACS-Dashboard类别-41BDF5.svg)](https://github.com/hacs/integration)
[![版本](https://img.shields.io/badge/版本-v0.3.4-blue.svg)](https://github.com/RockJesus/ha-map-cn/releases)
[![HA 最低版本](https://img.shields.io/badge/HA-2024.1-orange.svg)]()

Home Assistant 官方地图卡片在中国刷不出底图的替代方案——**功能与官方地图卡片一致，底图使用国内可达的高德 / 腾讯 / 天地图瓦片**。本项目是**仪表盘前端资源**（不是集成）：安装后即可通过 UI **从模板创建中国地图仪表盘**、在卡片界面可视化配置，**全程界面操作，不需要写任何 YAML / configuration.yaml**。

## 为什么需要它

HA 新版（2024.12+）地图卡片基于 MapLibre 渲染，底图瓦片全部经 HA core 内置 `map_tiles` 组件代理回源到 OpenStreetMap 服务器。在国内该回源不可达，地图显示为空白。

本卡片内置国内瓦片源，**无需修改任何官方文件、无需科学上网**，装完即用。

## 特性

- **仪表盘模板（与官方 Map 仪表盘一致）**：注册官方机制的 **dashboard strategy**——「设置 → 仪表盘 → 添加仪表盘」对话框直接可选**中国地图**，一键创建 Panel 视图的中国版地图仪表盘（UI，无需写代码）
- **功能与官方 `map` 卡片一致**：
  - `entities`（person / device_tracker / zone），支持自定义颜色、label 模式（name / state / attribute / icon）
  - `show_all`、`geo_location_sources`（含 label/attribute/unit/focus）
  - `auto_fit`、`fit_zones`、`show_zone_radius`、`default_zoom`
  - `hours_to_show` 历史轨迹
  - `dark_mode` / `theme_mode` 深浅色（深色自动滤镜）
  - **`map_style` 渲染风格**（与官方选项一致：default / colorful / natural / muted / gray / toner）
  - `cluster` 标记聚合（地图按钮可切换聚合/展开）
  - `conditions` 条件显示、`scale_ruler` 比例尺、`aspect_ratio`、`title`
  - zone 半径圈、GPS 精度圈
- **Overview 抽屉（与官方最新 Map 仪表盘一致）**：Panel 布局下左侧/底部显示 **人 / 设备 / 区域** Tab 列表 + 实体详情页 + **24 小时活动时间线**（进出区域/状态变化，可展开全部）
- **实体选择与聚焦**：点击地图标记或列表项选择实体（URL `entity_id` 参数与官方一致），自动聚焦并避开抽屉；聚焦缩放与官方一致——单点只放大到恰好清除最近标记（≤17 级），区域用球面圆边界整体纳入视野
- **国内底图**：高德（默认）/ 腾讯 / 天地图 / OSM，样式含标准、浅色、卫星、深色
- **坐标自动转换**：高德/腾讯（GCJ-02）自动把 WGS-84 实体坐标做火星坐标转换，位置不偏移；天地图/OSM 无需转换
- **person 区域定位兜底**（与官方一致）：person 无 GPS 坐标时回退到其所在第一个非被动区域的坐标
- **RTL 支持**：希伯来/阿拉伯等从右到左语言下抽屉与按钮自动换侧（与官方一致）
- **网格布局选项**（与官方一致）：grid 布局下自动跨全列、占 4 行
- **零外部依赖**：卡片为单文件自包含（已内置渲染引擎），国内无需任何 CDN
- **纯前端资源**：不是集成，不占用集成列表、不需要安装到 custom_components
- **全程 UI 配置**：添加卡片后所有选项（实体/颜色/底图/样式/轨迹/聚合/比例尺等）都在界面里可视化设置

## 快速开始（纯 UI，不需要写代码）

1. **安装卡片 JS**（二选一）：
   - **HACS（推荐）**：HACS → ⋮ → 自定义存储库 → 添加 `https://github.com/RockJesus/ha-map-cn`，**类别选「仪表盘」（Dashboard）** → 下载。HACS 2.x 界面里该类别名就叫 **Dashboard（仪表盘）**（旧名"前端" / Plugin）
   - **手动**：把 `map-cn.js` 放到 `/config/www/ha-map-cn/`（Releases 下载即得单文件 js）
2. **注册资源**：
   - **HACS 装：无需手动注册**——HACS 下载后会**自动注册**资源 `/hacsfiles/ha-map-cn/map-cn.js`（设置 → 仪表盘 → ⋮ → 资源 里能看到）
   - **手动装**：设置 → 仪表盘 → ⋮ → **资源** → 添加资源：URL `/local/ha-map-cn/map-cn.js`，类型选 **JavaScript 模块**
3. **刷新浏览器**（Ctrl+F5）
4. **创建中国地图仪表盘（UI，模板一键创建，推荐）**：设置 → 仪表盘 → **添加仪表盘** → 选择 **「中国地图」模板** → 输入名称（如"中国地图"）→ 创建。仪表盘即为 Panel 视图的中国版地图（顶部自动显示 人/设备/区域 Tab 与活动时间线）
   - 或创建普通仪表盘后「添加卡片」→ 搜索 **地图** → 选 **中国地图卡片**
5. **可视化设置（UI，可选）**：仪表盘右上角「编辑」→ 点击地图卡片 → 配置（底图供应商/样式/渲染风格下拉、实体选择器逐行选并设颜色、轨迹小时数、聚合、比例尺等）
6. **完成**：保存即看到中国版地图；仪表盘整页显示（Panel）时，地图顶部自动出现 **人 / 设备 / 区域** 切换

## 仪表盘示例（可选参考）

仓库内置 `dashboards/map-cn.yaml`（Panel 视图 + 地图卡片 + 概述 Tab），作为 YAML 方式的可选参考（不想写代码就按上面「快速开始」在 UI 里创建）：

```yaml
views:
  - title: 地图
    path: map
    type: panel
    cards:
      - type: custom:map-cn
        provider: gaode        # gaode | tencent | tianditu | osm
        style: normal          # normal | light | satellite | dark
        map_style: default     # default | colorful | natural | muted | gray | toner
        auto_fit: true
        fit_zones: true
        show_zone_radius: true
        hours_to_show: 24
        theme_mode: auto
        cluster: true
        scale_ruler: true
        show_all: true
```

YAML 模式引用方式（`configuration.yaml`）：

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

## 全部配置项

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `provider` | string | `gaode` | 底图供应商：`gaode` / `tencent` / `tianditu` / `osm` |
| `style` | string | `normal` | 地图样式：`normal` / `light` / `satellite` / `dark` |
| `map_style` | string | `default` | 渲染风格（与官方一致）：`default` / `colorful` / `natural` / `muted` / `gray` / `toner` |
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
- 确认已注册资源并硬刷新浏览器（Ctrl+F5）
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
<summary>v0.3.4（最新）</summary>

- **修复地图加载失败时卡片塌陷成 64px 错误条**（dyc 实测发现）：地图初始化出错（WebGL 不可用/底图瓦片加载失败/天地图 key 无效等）时，错误分支丢弃了 ha-card 全屏容器、直接输出错误条，panel 视图下卡片只剩标题栏高度——与官方一致改为**错误也渲染在 ha-card 容器内**（容器保持 `height:100%` 全屏链，容器内显示错误提示）
- **补全 ha-card 官方高度链**：v0.3.2 只在 `#card` 补了高度，漏了官方最关键的 `ha-card { height:100%; display:flex }`（百分比高度需穿透到 panel 视图容器），现完整对齐官方 hui-map-card 样式
</details>
<details>
<summary>v0.3.3（最新）</summary>

- **修复卡片打开即白屏/不渲染（show_all 路径崩溃）**：`_withMissingTracked` 补漏实体时把整个状态对象传给 `computeDomain`（应为 `entity_id`），模板求值即抛 `j.split is not a function`、卡片无法渲染——官方默认开启的 `show_all` 必触发
- **修复可视化编辑器配置页打不开**：编辑器实现 HA 标准协议 `hassChanged()`（前端创建编辑器后依次调用 `setConfig` → `hassChanged`），此前缺失该方法导致 UI 配置界面报错
</details>
<details>
<summary>v0.3.2（最新）</summary>

- **修复 panel 布局下地图不铺满全屏（大片主题背景残留）**：对照官方 hui-map-card 样式，panel/grid 布局时卡片容器补 `height:100%` + flex 撑满，地图全屏显示
</details>
<details>
<summary>v0.3.1</summary>

- **修复卡片加载失败（`Custom element doesn't exist: map-cn`）**：HA 对自定义卡片的元素名规则 = 类型去掉 `custom:` 前缀（`map-cn`），此前注册为 `map-cn-card` 导致卡片永远找不到；同步修正可视化编辑器元素名（`map-cn-editor`）
</details>
<details>
<summary>v0.3.0</summary>

- **修复「中国地图」仪表盘打开报 `Unknown type: map-cn`**：策略模板生成的卡片 `type` 补上 `custom:` 前缀（`custom:map-cn`，HA 自定义卡片必需）；同步修正 README/YAML 示例与冒烟测试断言
</details>
<details>
<summary>v0.2.9</summary>

- **安装说明修正**：HACS 2.x 下载后**自动注册资源**（`/hacsfiles/ha-map-cn/map-cn.js`），删除错误的 `/hacommunity` 手动注册步骤与残留重复段落——此前按旧说明手动注册 `/hacommunity` 路径会 404 导致"卡片加载不出来"
</details>
<details>
<summary>v0.2.8</summary>

- **对齐 HA 最新官方源码（2026-10-20 dev）**：逐行核对 `hui-map-card.ts` / `map-engine.ts` / `get_entity_location.ts` 后修复——
  - **聚焦缩放官方化**：`_focusZoom` 只放大到恰好清除最近标记（墨卡托像素距离计算，≤17 级）；区域用球面大圆角点 `circleBoundsPoints`（官方精确实现，替换原 8 点近似）
  - **person 区域定位兜底**：person 无坐标时回退第一个非被动 in_zone 坐标（官方 `getEntityLocation(stateObj, states)`）
  - **RTL 支持**：希伯来/阿拉伯等 RTL 语言下抽屉、按钮、视野 padding 自动换侧
  - **地图空白点击取消选择**（官方 `_handleMapClicked`）；`_handleMarkerClick` 增加"非过滤实体不选择"检查（与官方一致）
  - **`getGridOptions`**：grid 布局跨全列占 4 行（官方 full/rows 4）
  - **抽屉交互对齐**：选中态下抽屉尺寸变化自动重新聚焦；单 Tab 时抽屉收窄为 300px（`single-tab` 属性）；panel 布局按钮移到抽屉对侧
  - **Overview 装饰对齐**：未选中实体隐藏精度圈/半径圈（`hide_accuracy`/`hide_radius`/`selected`），区域 Tab 或配置显示时例外
</details>
<details>
<summary>v0.2.7</summary>

- **仪表盘模板**：注册官方 dashboard strategy——「设置 → 仪表盘 → 添加仪表盘」对话框直接选「中国地图」，一键创建中国版地图仪表盘（全程 UI，与官方 Map 仪表盘同构：Panel 视图 + `auto_fit/show_all`）
- **Overview 抽屉对齐官方最新**：人/设备/区域 Tab 列表（自动只显有内容的 Tab）+ 实体详情页 + **24 小时活动时间线**（进出区域/状态变化，可展开）
- **实体选择与聚焦**：点击标记/列表项选择实体（URL `entity_id`，与官方一致），自动聚焦避开抽屉
- **`map_style` 渲染风格**（官方 6 预设：default/colorful/natural/muted/gray/toner）+ 编辑器下拉
- show_all 补漏（后续定位的人/独立 tracker 自动出现）
</details>
<details>
<summary>v0.2.6</summary>

- 安装说明修正：HACS 2.x 中卡片资源类别名为 **「仪表盘」（Dashboard）**（旧名 前端/Plugin），安装时选该类别
</details><details>
<summary>v0.2.5</summary>

- 形态回归：纯**前端资源（仪表盘）**形态——移除 custom_components 集成，HACS 类别改回「前端」；安装 = HACS 前端类别（或手动放 js）→ UI 添加资源 → UI 创建仪表盘 → UI 配置卡片，全程无需写代码
</details>
<details>
<summary>v0.2.4</summary>

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
