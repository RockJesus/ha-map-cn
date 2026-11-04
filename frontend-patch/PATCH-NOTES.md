# 补丁设计与取舍说明

> 技术细节版：为什么这么改、每个文件改了什么、边界在哪里。使用说明见 `README.md`。
---

## 1. 先说清楚这件事的性质

| 项 | 结论 |
|---|---|
| 这是 HA 官方支持的插件吗 | **不是**。这是源码补丁，HA 升级后需要重新打 |
| 能用 HACS 安装吗 | 不能。必须改前端源码并重新编译 |
| 改了多少行 | 新增 1 个文件（219 行），在 9 个文件里插入约 80 处改动 |
| 会不会影响原有行为 | 不会。不配置 `basemap` 时，代码路径与原版**完全一致**（`basemapLayers()` 返回 `undefined`，直接走原逻辑） |
| 为什么不能做成 HACS 插件 | 底图是 `ha-map` 组件内部创建的图层，外部插件拿不到这个句柄；只能改源码或在运行时劫持 fetch（后者就是 `hass_tianditu.js` 的做法） |

---

## 2. 改了什么

### 新增文件

**`src/common/map/basemap.ts`** —— 底图提供方注册表

| 提供方 | 说明 |
|---|---|
| `auto`（默认） | 填了天地图 Key 就用天地图，否则用原生 OSM。**默认行为不变** |
| `osm` | 强制原生 OSM 矢量底图 |
| `tianditu` | 天地图矢量瓦片（`vec_w` 底图 + `cva_w` 中文注记，双层） |
| `tianditu-satellite` | 天地图影像（`img_w` + `cia_w`） |
| `amap` | 高德瓦片（**有 GCJ-02 偏移，故意不做纠偏**，仅作兜底） |
| `custom` | 任意 XYZ 模板，配合 `basemap_tile_url` |

关键设计：`resolveBasemapProvider()` 是唯一判定入口，`basemapLayers()` 返回 `undefined` 表示"保持官方原样"。这样"没配置"和"配置了"两条路径彻底分开，不会悄悄改掉现有用户的行为。

### 修改文件

| 文件 | 改动 |
|---|---|
| `common/map/map-engine.ts` | `MapEngineOptions` 加 `basemap?: BasemapProviderConfig` |
| `common/map/base-layer.ts` | 新增 `createRasterBasemapLayer()`：用 Leaflet 栅格图层铺底，`maxNativeZoom` 卡在数据源上限（天地图 18），再放大就复用上一级瓦片而不是请求 404 |
| `common/map/engines/leaflet-map-engine.ts` | 有 `basemap` 时跳过 `createBaseLayer()`，直接铺栅格底图 |
| `common/map/engines/maplibre-map-engine.ts` | 有 `basemap` 时在样式首帧后插入栅格图层，id 前缀 `ha-basemap-`；`setStyle()` 后自动重铺（官方换样式会把非 `ha-map-` 前缀的图层全清掉） |
| `components/map/ha-map.ts` | 加 `basemap` 属性，透传给引擎 |
| `panels/lovelace/cards/types.ts` | `MapCardConfig` 加 5 个字段 |
| `panels/lovelace/cards/hui-map-card.ts` | 从卡片配置解析底图（`memoizeOne` 缓存），绑定到 `ha-map` |
| `panels/lovelace/editor/config-elements/hui-map-card-editor.ts` | 编辑器新增「底图来源」折叠区：提供方下拉 + Key + 自定义 URL + 版权 + 最大级别；`auto` 不写回配置，避免给每张卡片塞噪音 |
| ~~`panels/lovelace/strategies/map/map-view-strategy.ts`~~ | **已回退**。原计划让 Map 仪表盘继承 `hass.config.basemap`，但 `HassConfig` 类型里没有 `basemap` 字段，加继承需要连后端配置一起改。当前版本：仪表盘用官方默认底图，只有卡片支持 `basemap` |
| `i18n/en.json`、`i18n/zh-Hans.json` | 16 条文案，中英各一份 |

### 卡片配置（新增字段）

```yaml
type: map
entities:
  - person.me
basemap: tianditu                    # auto(默认) | osm | tianditu | tianditu-satellite | amap | custom
basemap_tianditu_key: 你的Key         # 天地图控制台申请，免费 1 万次/天
basemap_max_zoom: 18                 # 数据源上限，默认 18
# 仅 custom 用：
basemap_tile_url: https://tiles.example.com/{z}/{x}/{y}.png
basemap_attribution: "© Example"
```

---

## 3. 安装

```bash
# 1. 拿官方前端源码（版本要和你的 HA Core 对齐）
git clone --depth 1 -b 20261105.0 https://github.com/home-assistant/frontend.git
cd frontend && pnpm install

# 2. 打补丁（自动备份，自动合并翻译键）
bash /path/to/ha-basemap-patch/apply.sh "$(pwd)"

# 3. 编译
pnpm run build     # 产物在 dist/

# 4. 挂到 HA 上，二选一
#    a) 开发模式（改完直接生效，重启 HA）
#       configuration.yaml:
#         frontend:
#           development_repo: /config/ha-frontend-patched   # 指向 dist 的上一级
#    b) 覆盖安装包（升级即失效，需重做）
#       把 hass_frontend/ 内容替换到 site-packages/hass_frontend/，删掉 HA 的 .cache 与浏览器缓存
```

> 注意构建产物目录是 **`hass_frontend/`**，不是 `dist/`（HA 前端 2026.x 的 gulp 构建链改了输出路径）。

**回滚**：`apply.sh` 会打印一条完整命令，包含恢复源文件 + 恢复翻译 JSON + 删除新增文件。

---

## 4. 验证清单

| # | 用例 | 预期 |
|---|---|---|
| B-01 | 不配 `basemap` | 与打补丁前完全一致（OSM 矢量、标记、轨迹、聚合） |
| B-02 | `basemap: tianditu` + 有效 Key | 天地图矢量底图 + 中文地名，标记叠在上层 |
| B-03 | `basemap: tianditu` + 无效 Key | 底图空白、标记仍显示、控制台无未捕获异常 |
| B-04 | 缩放到 19、20 级 | 复用 18 级瓦片放大，不出现白块 |
| B-05 | 切换 `map_style` | 底图不变（栅格无配色可分），标记与 UI 正常 |
| B-06 | 切换 `theme_mode` | 底图不变，卡片外框跟随主题 |
| B-07 | 无 WebGL2 的旧平板 | 栅格底图正常（该路径本就走 Leaflet） |
| B-08 | 旧平板 + 原生 OSM | 与官方一致，回退经典栅格 |
| B-09 | 编辑器中切换提供方 → 保存 → 重开 | 配置正确、不回写 `basemap: auto` |
| B-10 | Map 仪表盘（panel view） | People/Devices/Zones 页签仍在，底图跟随策略配置 |
| B-11 | 天地图 Key 出现在网络请求里 | **会暴露**给任何能看板的人，评估配额风险 |
| B-12 | 中文界面 | 「底图来源」等文案为中文，未出现键名 |

---

## 5. 已知限制（写在这里，避免被当 Bug）

1. **矢量底图无法替换**：官方底图是 `@versatiles/style` 生成的 Shortbread 样式，换成别的矢量源等于重做整套配色和字体，工作量和维护成本都不是这个补丁量级。国内方案统一用栅格。
2. **`map_style` 对国内底图无效**：栅格瓦片没有图层可改色。这是能力差异，不是缺陷。
3. **高德有偏移**：GCJ-02 与 WGS84 差 300~500 米，补丁**故意不做纠偏**（纠偏需要服务端代理，等于把复杂度塞回 HA）。仅作兜底选项。
4. **天地图 Key 在前端可见**：设计使然。
5. **不是上游代码**：没有 PR 合入计划，升级 HA 后需重跑 `apply.sh`。上游若要支持，得先过 architecture 讨论。

---

## 6. 关于"提交给官方"

上游那条路是存在的，但要按顺序走：

1. 先在 `home-assistant/architecture` 开议题，说明"支持自定义瓦片源"的动机（网络受限地区、离线部署、隐私）；
2. 说明 OSMF 政策边界（不能鼓励批量抓取、需要自定义瓦片的版权声明与缓存策略）；
3. 提 PR 时大概率被要求：只做 raster 源、配置项收进 `map_tiles` 集成而非卡片、默认关闭。

补丁里的 `basemap.ts` 就是按这个思路写的：提供方注册表 + 显式 `osm` 默认值 + 不碰矢量样式。要提 PR 可以直接拿它当原型。
