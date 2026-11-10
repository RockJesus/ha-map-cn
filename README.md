# 🗺️ ha-map-cn · 中国地图卡片

> Home Assistant 里直接能用的国内地图：高德 / 天地图底图，浏览器直连瓦片，不改 HA、不装代理、不需要服务器能翻墙。交互与视觉对齐官方 `hui-map-card`。

[![HACS Default](https://img.shields.io/badge/HACS-Default-41BDF5.svg)](https://hacs.xyz)
[![latest](https://img.shields.io/github/v/release/RockJesus/ha-map-cn?display_name=tag)](https://github.com/RockJesus/ha-map-cn/releases/latest)
[![HACS Action](https://github.com/RockJesus/ha-map-cn/actions/workflows/hacs.yaml/badge.svg)](https://github.com/RockJesus/ha-map-cn/actions/workflows/hacs.yaml)
[![Lint](https://github.com/RockJesus/ha-map-cn/actions/workflows/lint.yml/badge.svg)](https://github.com/RockJesus/ha-map-cn/actions/workflows/lint.yml)
[![license](https://img.shields.io/github/license/RockJesus/ha-map-cn)](LICENSE)

**一键安装**（HACS → 探索并下载 → 搜「China Map Card」）：

[![Open in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=RockJesus&repo=ha-map-cn&category=dashboard)

---

## ✨ 特性

- 🇨🇳 **国内直连底图**：高德街道 / 高德卫星 / 天地图 / 天地图卫星 / OSM，高德自动 GCJ-02 纠偏
- 📱 **移动端打磨**：底部抽屉（对齐官方 `ha-snap-bottom-sheet`）、双指平滑捏合、长按才允许拖家位置/半径
- 🧭 **交互对齐官方**：点标记 = 聚焦飞行，再点 = 详情；人 / 设备 / 区域三 Tab 概览、最近活动时间线、GPS 精度圈
- 📍 **家的位置直接编辑**：地图上长按拖动家图标/半径手柄，松手自动 `zone.edit` 同步回 HA「我的家」
- 🛰️ **轨迹线**：自动订阅 `history/stream`，悬停显示时间；可选高德实时路况叠加
- 🎨 **暗色主题**：跟随 HA，自动对瓦片做反相滤镜；卫星影像自动豁免
- 🪶 **零依赖**：手写轻量瓦片引擎，单文件 ~170 KB，无 Leaflet / MapLibre

## 📸 截图

![桌面布局](images/layout-desktop.jpg)

![标记聚合](images/cluster-on.jpg)

## 🚀 安装

**HACS 默认仓库（推荐）**

1. HACS → **探索并下载存储库** → 搜「**中国地图 / China Map Card**」
2. 点 **下载**，HACS 自动注册 Lovelace 资源
3. 刷新浏览器，在卡片选择器里就能看到「中国地图卡片」

**兜底（自定义存储库）**：HACS → 右上角 ⋮ → 自定义存储库 → 填 `https://github.com/RockJesus/ha-map-cn`，类别 **Lovelace / Dashboard**。

**手动安装**：把 Release 里的 `ha-cn-map-card.js` 放到 `/config/www/`，设置 → 仪表盘 → 资源里加 `/local/ha-cn-map-card.js`，类型 **JavaScript Module**。

> HACS ≥ 2.0 会自动用 `?hacstag=<版本>` 给资源 URL 加缓存戳，升级后不需要手动强刷。

## 🧭 为什么需要它

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


## 配置

### 图形界面（推荐）

在仪表盘编辑模式下点卡片的「编辑」，弹出的是**完整可视化编辑器**，无需写 YAML：

| 表单区域 | 可设置 |
|---|---|
| 标题 | 卡片顶部标题，留空则不显示标题栏 |
| 底图来源 | 高德 / 高德卫星 / 天地图 / 天地图卫星 / OSM（下拉选择） |
| 天地图 Key | **仅当选天地图时出现**，自动联动 |
| 显示哪些标记 | 自动显示全部 / 显示区域 / 标记聚合 / 标记状态行 / 首次自动缩放 |
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
  - entity: device_tracker.car   # 对象形式：逐实体覆盖显示
    name: 家里那台
    color: "#e53935"
    label_mode: attribute
    attribute: battery_level
    unit: "%"
show_all: false              # true = 自动列出所有 person./device_tracker./geo_location.
show_zones: false            # true = 显示 zone.* 区域图标
show_status: true            # 标记下方状态行（在家 / 离线 / 速度 / 电量），默认开
show_accuracy: true          # 显示 gps_accuracy 精度圈（官方行为），默认开
geo_location_sources: []     # 按 source 过滤 geo_location 实体

layout: auto                 # auto(默认) | full | compact
fullscreen: true             # 等价 layout: full
show_cluster: true           # 标记聚合（默认开）；相近标记合并成气泡
show_labels: true            # 标记下方显示名称
persist: true                # 允许抽屉改动存到浏览器；false = 只在本次浏览有效
fit_entities: true           # 首次自动缩放到所有实体
default_zoom: 12             # fit_entities: false 时生效

hours_to_show: 0             # >0 时绘制轨迹线（0=关闭，24=最近24小时）
track_width: 3               # 轨迹线宽
track_opacity: 0.85          # 轨迹不透明度
show_traffic: false          # 高德实时路况叠加（仅 amap 底图）

# —— 外观（v1.0.x 新增）——
theme_mode: auto             # auto(跟随 HA 主题) | light | dark
label_mode: name             # name | state | attribute | none（可逐实体覆盖）
aspect_ratio: ""             # 如 "16:9"；填了忽略 height
show_zone_radius: true       # 按 zone.radius 画虚线半径圈
fit_zones: false             # 自动缩放时把半径圈算进视野
dedupe_trackers: true        # person 已覆盖的 device_tracker 不再单独画点
respect_hidden: true         # 跳过实体注册表里隐藏的实体（hidden_by 非空，v1.1.4）
```

> 完整字段以 `setConfig` 默认值为准（[源码](ha-cn-map-card.js)）；抽屉与可视化编辑器改过的选项会存在浏览器本地，优先于 YAML，`persist: false` 可关闭这一行为。

### 条件显示（conditions，v1.1.4）

和官方条件卡片同一语义：`conditions` 里每一条都满足才渲染这张卡，否则整张卡隐藏：

```yaml
conditions:
  - entity: binary_sensor.workday      # 状态匹配
    state: "on"
  - entity: person.zhangsan            # 状态不匹配
    state_not: "home"
  - entity: sensor.car_battery         # 属性匹配（attribute 指定取值来源）
    attribute: battery_level
    state: "80"
```

支持 `state` / `state_not` / `attribute` 三种字段；实体不存在视为不满足；`conditions` 缺省或为空数组时永远显示。只写 YAML，图形编辑器暂不提供这一项。

### geo_location 来源与逐实体写法（v1.1.5）

`entities` 对象条目新增三个字段：

```yaml
entities:
  - entity: sensor.car                # 数值标签加单位
    label_mode: attribute
    attribute: battery_level
    unit: "%"
  - source: nmap                      # 不写 entity：纳入该来源的全部 geo_location 实体
    label_mode: state
  - entity: person.zhangsan
    focus: true                       # 首帧渲染后把视野聚焦到它（URL 深链优先）
```

`source` 写法等价于全局 `geo_location_sources`，但可以只给这一路来源设置 `label_mode` / `name` / `color`。编辑器列表里 source 条目显示为「geo_location 来源：xxx」，可单独移除。

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
- 沿线每 90px 画一个小三角**指示行进方向**，随平移/缩放实时重算，带白色描边不与轨迹线混淆
- 卡片从仪表盘移除时自动取消订阅，不留后台连接

> 前提：实体有历史记录。刚装的 HA 或刚接入的设备需要等一段时间才有数据。

## 交互（对齐官方 hui-map-card）

![聚焦飞行 / 精度圈 / 轨迹方向箭头](images/interact-official.jpg)

### 点击标记 = 聚焦，再点 = 详情

和官方一致，点击标记不再直接弹窗：

| 操作 | 行为 |
|---|---|
| 第一次点标记 | 地图**平滑飞到**该实体（已在视野内则只平移不缩放），标记加主题色光环，**面板切到该实体的「最近活动」** |
| 再点同一标记 | 打开 more-info 详情弹窗 |
| 点地图空白处 / 按 `Esc` | 取消选中，光环消失，详情退回列表 |
| 点概览列表项 | 同上：首次聚焦并看最近活动，再次打开详情 |

飞行时长 550ms，easeInOutQuad；**飞行途中用鼠标拖动或滚轮会立即接管**，不会和动画抢方向。
全屏且面板展开时，飞行落点会往面板对侧偏移，保证标记不被遮挡。

### 最近活动（对齐官方 overview 的 activity 时间线）

点标记/列表项后，面板显示该实体的详情头部（名字 + `状态 · 相对时间`）和**最近 24 小时活动**：

| 元素 | 规则 |
|---|---|
| 数据源 | WebSocket `history/history_during_period`（和官方 `fetchDateWS` 同一条消息） |
| 时间窗 | 最近 **24 小时** |
| 条目 | 只取**状态变化**，跳过 `unavailable` / `unknown`（掉线不算活动） |
| 排序 | 最新在上 |
| 条数 | 最多 **20** 条，默认显示 **5** 条，超出显示「显示全部 N 条」 |
| 每行 | 头像（`entity_picture` → 首字母）、状态文字（`在家` / `离家` / `在 公司`）、`HH:MM · 相对时间` |
| 选中区域 `zone.*` | 改为显示**人员进出记录**：`我 进入 · 21:03 · 5 小时前` |

没有历史数据（新装的 HA、集成未记录）时显示「最近 24 小时没有活动」；`history` 集成被禁用或查询失败时显示「活动记录不可用」。

### 键盘快捷键

地图获得焦点后（点一下地图即可）：

| 按键 | 行为 |
|---|---|
| `+` / `-` | 放大 / 缩小一级 |
| `方向键` | 平移（`Shift` + 方向键 = 大步） |
| `Esc` | 取消选中 |

### GPS 精度圈

实体带 `gps_accuracy`（米）时自动画一圈半透明范围，和官方的精度可视化一致：

- 半径按当前纬度实时换算成像素，缩放时跟着变
- 颜色跟随实体配色（`entities[].color` → 属性 `color` → 按域默认色）
- 高德底图下圆心与该实体标记一起做 GCJ-02 纠偏，不会和标记错位
- `zone.*` 不画；半径小于 2px 或大到超出视口 3 倍时自动跳过
- 关掉：设置抽屉关「GPS 精度圈」，或 YAML 写 `show_accuracy: false`

## 标记状态行

每个标记下方除了名称，还有一行**短状态**，一眼看出谁在哪、设备还有没有电：

![标记状态行](images/marker-status.jpg)

| 实体状态 | 标记显示 |
|---|---|
| 在某个 `zone.*` 里 | 区域名，如 `在家` / `公司` |
| `home` | `在家` |
| `not_home` 且无速度 | `离家 · 4 分钟前` |
| 有 `speed` 属性 | `51 km/h`（属性为 mph 时显示 mph） |
| 有 `battery_level` 属性 | `电量 23%` |
| `unavailable` / `unknown` | `离线` + **整个头像灰显半透明** |

判定优先级：离线 > 区域名 > 速度 > 电量 > 离家 > 相对时间（`last_updated`，取不到时退回 `last_changed`）。区域类标记（家/公司图标）不显示状态行。

关掉：抽屉里取消「标记显示状态」，或 YAML 写 `show_status: false`。

## 实时路况

`show_traffic: true` 会在高德底图上叠加实时路况瓦片（红黄绿线），或点卡片左上角 🚦 一键开关。

- **仅支持 `amap` / `amap-satellite`**：路况瓦片和底图必须同一坐标系
- 天地图/OSM 下该按钮无效，避免错位

## 布局：自动全屏 / 占满仪表盘

把卡片放进 **panel 视图**（仪表盘 → 编辑 → 视图类型选「面板」），它会自动铺满整屏，
行为和官方地图卡片一致。

| 视图类型 | 卡片表现 |
|---|---|
| **panel（面板）** | 地图铺满整屏，右侧悬浮控件，左上角（手机为底部）概览面板 |
| sections / masonry / grid | 按 `height` 给固定高度，底部抽屉默认收起 |
| sections + `fill: true` | 地图脱离文档流铺满视口——**在 sections 视图里也能全屏**，不必改成面板视图 |
| 任意（`layout: full`） | 强制按全屏布局渲染 |
| 任意（点左下/左上 ⛶ 按钮） | 立刻全屏，再点或按 `Esc` 退出——**不改 YAML 也能全屏** |

| 手机（底部抽屉） | 桌面（左侧浮层） |
|---|---|
| ![phone](images/layout-phone.jpg) | ![desktop](images/layout-desktop.jpg) |

判定逻辑（v0.9.4 重写）：

1. 先看 **`hui-card` 给卡片元素赋的 `layout` 属性**——panel 视图里它会被设成 `"panel"`，
   这是官方 `hui-map-card` 用的同一个信号（比爬 DOM 可靠，因为卡片挂在 shadow root 里，
   往上的 `parentElement` 会直接断掉）；
2. 没有这个信号时，再**穿透 shadow root** 往上找 `hui-panel-view` / `hui-grid-section`；
3. 判定为全屏但**实测没占满视口**时（panel 视图不给高度、sections 格子只有 410px），
   自动升级为 `position:fixed` 真正铺满——不用你再手动补 `fill`。

想强制指定用 `layout`：

```yaml
type: custom:ha-cn-map-card
layout: full      # full=铺满 | compact=固定高度 | 不填=自动判断
```

**视图是 sections（网格）、卡片被困在固定高度格子里？** 三种办法任选：

```yaml
type: custom:ha-cn-map-card
fill: true        # 写法一：YAML 强制铺满（最稳）
```

- 写法二：点卡片上的 ⛶ 全屏按钮，`Esc` 或再点一次退出（无需改 YAML）
- 写法三：可视化编辑器里「显示模式」选「总是铺满全屏」

### 概览面板（对齐官方 hui-map-overview）

| 特性 | 说明 |
|---|---|
| 三个标签 | **人 / 设备 / 区域**，只显示有内容的标签 |
| 列表项 | 头像或首字母 + 名称 + 「在 某区域 · 4 分钟前」 |
| 点击列表项 | 打开该实体的 more-info 弹窗 |
| 展开/收起 | 点手柄或底部那条遮罩；手机上是底部抽屉，桌面是左上浮层 |
| 缩放自适应 | 自动适配视野时会把面板占的区域让出来，标记不会被盖住 |

### 控件（对齐官方）

右侧竖排：`+` / `−` 成组 → 显示全部 → 聚合开关 → 路况 → 设置。
按压缩放控件位置：panel 全屏在**右侧**（官方行为，避开左侧概览面板），紧凑卡片在**左侧**。

## 标记聚合

相近的标记会自动合并成一个气泡，避免 8 个设备叠在同一个点上只见最上面那个。

| | 关闭聚合 | 开启聚合 |
|---|---|---|
| 效果 | ![off](images/cluster-off.jpg) | ![on](images/cluster-on.jpg) |

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

## 隐私

- 底图瓦片请求只带瓦片坐标（`z/x/y`），**不包含任何实体数据**
- 实体位置只在你自己的浏览器里渲染，不会上传到任何第三方
- 历史轨迹走你自家 HA 的 WebSocket（`history/stream`），不经过外部服务
- 唯一可选的对外请求是底图瓦片本身；天地图需要 Key，高德/OSM 不需要

## 常见问题

**底图还是不出来？**
F12 打开开发者工具 → Network，看 `autonavi.com` 或 `tianditu.gov.cn` 的请求。若返回 4xx/被拦截，检查浏览器插件（广告拦截器可能误杀瓦片域名）。

**标记位置偏了几百米？**
说明 `basemap` 是高德但 `needsShift` 没生效，或你自己在实体里存的就是 GCJ-02 坐标（部分国产 GPS 设备直接输出 GCJ-02）。后者请把 `basemap` 改成 `amap` 之外的值，或提 issue。

**天地图返回 418？**
Key 无效或未开通「浏览器端」类型。到控制台检查应用类型。

**能显示轨迹吗？**
能。配置 `hours_to_show: 24`（或抽屉里选轨迹时长）即按 `history/stream` 订阅历史并画折线，详见「轨迹线」章节。

**标记下面那行小字是什么？**
实体状态摘要：在家 / 区域名 / 离家+时间 / 车速 / 电量，失联实体显示「离线」并灰显。不想要就设 `show_status: false`，详见「标记状态行」。

**标记图标为什么是方块/放大镜？**
卡片按实体域给默认图标：`person.*` → 人像，`device_tracker.*` → 手机，其余 → 定位针。若实体自带 `icon` 属性会优先用它的。方块说明 HA 前端没加载出 MDI 图标字体，刷新页面即可。

**左下角比例尺会跟着缩放变吗？**
会。按当前纬度的墨卡托比例实时换算，自动取 1/2/5 × 10^n 的整齐距离。

**左上角第三个按钮是什么？**
「显示全部」——把视野重新适配到所有标记，拖动/缩放跑偏后一键复位。

**性能和官方比如何？**
纯 DOM + img 瓦片，无 WebGL。中低端手机反而比官方的 MapLibre 更流畅，但没有 3D 和矢量缩放平滑度。

---

## 发布与兼容（HA 自定义卡片规范）

| 项目 | 取值 |
|---|---|
| 卡片类型 | `custom:ha-cn-map-card`（`window.customCards` 注册，带 `preview` 与文档链接） |
| 资源类型 | **JavaScript Module**（单文件 ESM，无运行时依赖） |
| 发布产物 | 每个 GitHub Release 附带 `ha-cn-map-card.js` 单文件 asset（UTF-8 无 BOM） |
| HACS 元数据 | `hacs.json`：`name` / `filename` / `render_readme` / `hide_default_branch` / `homeassistant` |
| 最低 HA | 2024.1（`getGridOptions` 与旧 sections 接口都兼容） |
| 仓库元数据 | 描述 + topics（`hacs` / `home-assistant` / `lovelace` / `custom-card`），CI 跑 HACS Action 与 ESLint |
| 编辑器 | `getConfigElement()` 返回 `ha-cn-map-card-editor`；`getStubConfig()` 提供默认配置 |

> 手工安装只需一个文件：把 release 里的 `ha-cn-map-card.js` 放到 `/config/www/`，资源里加
> `/local/ha-cn-map-card.js`（类型 JavaScript Module）。HACS 会自动读取 release asset 并注册资源。

## 开发

零构建、零依赖、原生 ES 模块：改完代码直接刷新页面就生效，没有打包步骤。入口 `ha-cn-map-card.js` 只负责注册自定义元素，实现拆在 `src/` 下。

要脱离 HA 调样式，给卡片喂一份假数据即可：`card.setConfig({...})` 之后设 `card.hass = { states: {...} }`，标记和区域就会渲染；依赖 `callWS` 的轨迹、历史、实体注册表会自动跳过，不会报错。

构建与检查：`pnpm install` 后，`pnpm lint`（ESLint，零告警是发布门槛）、`pnpm build`（esbuild 把 `src/` 打成发布产物 `ha-cn-map-card.js`，产物要提交进仓库）。

文件结构：

```
ha-cn-map-card.js       # 发布产物：esbuild 打包 src/ 的单文件（提交进仓库）
src/main.js             # 构建入口：注册卡片与编辑器两个自定义元素
src/shared.js           # 共享常量与工具（底图源 / GCJ-02 纠偏 / 布局 / 图标 / 本地存储）
src/engine.js           # 轻量 XYZ 瓦片引擎（投影 / 平移 / 缩放 / 标记 / 聚合 / 轨迹）
src/card.js             # Lovelace 卡片主类
src/editor.js           # 可视化编辑器
hacs.json               # HACS 元数据（filename 指向根目录的 js）
.hacsignore             # HACS 下载时排除的文件
eslint.config.mjs       # ESLint 平面配置
images/                 # README 截图
.github/workflows/      # HACS 校验 + ESLint
```

---

## 版本号规则

版本号固定 `vX.Y.Z` 三段，**逐位进位**：每一位只允许 `0–9`，满十进一，永远不出现 `v0.9.10`、`v1.10.0` 这种两位数段。

| 当前 | 下一版 |
|---|---|
| v0.9.8 | v0.9.9 |
| v0.9.9 | **v1.0.0** |
| v1.0.9 | v1.1.0 |
| v1.9.9 | v2.0.0 |

一次发布 = 三处同步：`ha-cn-map-card.js` 头部注释与 `console.info` 的版本串、本 README 的版本历史新增一条、同名 git tag + GitHub Release。

---

## 已知限制

1. **无构建无压缩**：原生 ES 模块（入口 + `src/` 四个模块），未压缩约 160KB。要瘦身可后续接 esbuild 打包
2. **聚合为屏幕像素贪心算法**：不做层级金字塔，缩放到不同级别时每次重算；实体过千会有明显卡顿（DOM 标记方案的天花板）。
3. **瓦片无本地缓存**：依赖浏览器 HTTP 缓存。
4. **高德瓦片非官方 API**：用的是 `webrd0x.is.autonavi.com` 公开瓦片端点，无 SLA 保证。生产环境建议换天地图（有正式 Key 和配额）。

### 后续可做（未排期）

- 尊重实体注册表的 `hidden` 标志（官方 `_getAllEntities` 会跳过用户在 UI 里隐藏的实体），需额外拉一次 `config/entity_registry/list`
- `conditions` 条件显示（官方 `_meetsConditions`）
- `geo_location_sources` 的对象形式（`source` / `label_mode` / `attribute` / `unit` / `focus`）

## License

MIT
