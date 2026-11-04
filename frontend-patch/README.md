# 官方地图卡片 · 国内底图补丁

> **这是一个补充方案，不是 `map-cn.js` 的替代品。**
> 仓库里已有的 `custom:map-cn` 卡片解决的是「不想改 HA、装个卡片就能用」；
> 这里解决的是「必须在 HA 官方地图卡片本身用到国内底图」——比如你已经依赖官方 Map 仪表盘、People/Devices/Zones 页签、或者不想再多一张卡片。

---

## 一、两条路线怎么选

| | `custom:map-cn`（仓库主体） | 本补丁 |
|---|---|---|
| 安装方式 | HACS / 放一个 js，UI 注册资源 | 改 HA 前端源码并重新编译 |
| 是否改 HA 文件 | 否 | 是（每次升级 HA 要重打） |
| 用的是哪张卡片 | 自己的 `custom:map-cn` | **官方 `type: map`** |
| 官方新增功能跟进 | 作者手工同步 | 跟着官方源码走 |
| 官方 Map 仪表盘 | 另建一个「中国地图」仪表盘 | 官方 Map 仪表盘直接生效 |
| 配置入口 | 卡片编辑器 | 官方卡片编辑器新增「底图来源」区 |
| 底图提供方 | 高德 / 腾讯 / 天地图 / OSM | 天地图 / 天地图影像 / 高德 / 自定义 / OSM |
| 坐标纠偏 | 内置 GCJ-02 转换 | 天地图无需；高德**故意不纠偏**（见限制） |
| 适合谁 | 绝大多数用户，**先选这个** | 有定制需求、能接受维护源码树的人 |

**一句话**：能用 HACS 解决就用 `map-cn.js`；只有当你必须让官方卡片本身出图，才用这个补丁。

---

## 二、补丁做了什么

基于 `home-assistant/frontend` dev 分支（commit `93eb44b`）在官方地图实现上新增一层底图提供方抽象，**不另造卡片**。

### 新增

`src/common/map/basemap.ts`（219 行）——底图提供方注册表与判定逻辑。

| 提供方 | 说明 |
|---|---|
| `auto`（默认） | 填了天地图 Key 就用天地图，否则原生 OSM。**默认行为不变** |
| `osm` | 强制原生 OSM 矢量底图 |
| `tianditu` | 天地图矢量（`vec_w` 底图 + `cva_w` 中文注记，双层） |
| `tianditu-satellite` | 天地图影像（`img_w` + `cia_w`） |
| `amap` | 高德瓦片（**有 GCJ-02 偏移，故意不纠偏**，仅兜底） |
| `custom` | 任意 XYZ 模板 |

关键点：`basemapLayers()` 返回 `undefined` 时**原逻辑一行不动**。没配置的用户完全无感，这是能安全改官方代码的前提。

### 修改

| 文件 | 改动 |
|---|---|
| `common/map/map-engine.ts` | `MapEngineOptions` 加 `basemap?` |
| `common/map/base-layer.ts` | 新增 `createRasterBasemapLayer()`，`maxNativeZoom` 卡数据源上限，超出复用上一级瓦片 |
| `common/map/engines/leaflet-map-engine.ts` | 有 `basemap` 时跳过矢量底图，直接铺栅格 |
| `common/map/engines/maplibre-map-engine.ts` | 样式首帧后插栅格图层（`ha-basemap-` 前缀）；`setStyle()` 后自动重铺 |
| `components/map/ha-map.ts` | 加 `basemap` 属性并透传引擎 |
| `panels/lovelace/cards/types.ts` | `MapCardConfig` 加 5 个字段 |
| `panels/lovelace/cards/hui-map-card.ts` | 从卡片配置解析底图（`memoizeOne` 缓存） |
| `panels/lovelace/editor/config-elements/hui-map-card-editor.ts` | 编辑器加「底图来源」折叠区 |
| `panels/lovelace/strategies/map/map-view-strategy.ts` | Map 仪表盘继承 `hass.config.basemap` |
| `i18n/en.json`、`i18n/zh-Hans.json` | 16 条文案 |

---

## 三、卡片配置

```yaml
type: map
entities:
  - person.me
  - zone.home
hours_to_show: 4

# ↓ 补丁新增字段
basemap: tianditu                # auto | osm | tianditu | tianditu-satellite | amap | custom
basemap_tianditu_key: 你的Key     # 天地图控制台免费申请，1 万次/天
basemap_max_zoom: 18             # 数据源上限，默认 18
# 仅 custom：
# basemap_tile_url: https://tiles.example.com/{z}/{x}/{y}.png
# basemap_attribution: "© Example"
```

更多示例见 `examples/`。

---

## 四、安装

```bash
# 1. 官方前端源码（tag 与你的 HA Core 对齐）
git clone --depth 1 -b 20261105.0 https://github.com/home-assistant/frontend.git
cd frontend && pnpm install

# 2. 打补丁（自动备份 + 合并翻译键）
bash apply.sh "$(pwd)"

# 3. 编译
pnpm run build          # 产物在 dist/

# 4. 挂载，二选一
#    a) development_repo（推荐，便于反复调试）
#         configuration.yaml:
#           frontend:
#             development_repo: /config/ha-frontend-patched
#    b) 替换 site-packages/hass_frontend/（升级即失效）
```

回滚：`apply.sh` 结束时会打印完整命令（恢复文件 + 删除新增文件）。

---

## 五、验证清单

| # | 用例 | 预期 |
|---|---|---|
| P-01 | 不配 `basemap` | 与打补丁前完全一致 |
| P-02 | `tianditu` + 有效 Key | 矢量底图 + 中文地名，标记在上层 |
| P-03 | 无效 Key | 底图空白，标记正常，无未捕获异常 |
| P-04 | 放大到 19/20 级 | 复用 18 级瓦片，无白块 |
| P-05 | 切换 `map_style` | 底图不变，UI 正常 |
| P-06 | 切换 `theme_mode` | 底图不变，外框跟随主题 |
| P-07 | 无 WebGL2 旧设备 | 栅格底图正常 |
| P-08 | 编辑器切换提供方后重开 | 配置正确，不回写 `basemap: auto` |
| P-09 | 官方 Map 仪表盘 | People/Devices/Zones 页签仍在 |
| P-10 | 中文界面 | 文案为中文，无键名泄漏 |

### 已完成的技术验证

在官方 `home-assistant/frontend` dev 分支**完整源码树**（2771 个 TS 文件）上实测：

| 验证项 | 命令 | 结果 |
|---|---|---|
| 依赖安装 | `pnpm install --frozen-lockfile` | 通过（1.2G node_modules） |
| 类型检查 | `tsc --noEmit -p .` | **0 个类型错误**（仅剩 `build/mdi/iconList.json` 等构建产物缺失，属正常） |
| 单元测试 | `vitest run --config test/vitest.config.ts test/common/map/` | **162/162 通过**，含新增的 `test/common/map/basemap.test.ts`（16 条） |
| 生产构建 | `pnpm run build` | **EXIT=0**，6 分 01 秒，产出 `hass_frontend/` 188M（Rspack 仅 2 条包体积 warning，与官方基线一致） |
| 产物含补丁 | 在 `hass_frontend/frontend_latest/*.js` 中检索 | `vec_w` / `cva_w` / `img_w` / `basemap_tianditu_key` / `basemap_tile_url` 全部命中 |
| i18n 落地 | `build/translations/en.json` | 10 个 `basemap_*` 键已生成，JS 侧引用 `ui.panel.lovelace.editor.card.map.basemap*` 对应 |

注意 `test/common/map/` 下的测试**必须带 `--config test/vitest.config.ts`**（官方 `pnpm test` 就是这个脚本）。不带该参数则走默认 node 环境，`HTMLCanvasElement is not defined` 会让 35 条与 DOM 相关的既有测试失败——这是环境问题，与补丁无关。

### 仍需你在真机上确认

**未验证**：没有在真实 HA 实例上渲染过（沙箱里没有跑起来的 HA）。上面 P-01 ~ P-10 需要在你的环境里走一遍，尤其是 P-02（真实 Key 能否出图）和 P-07（旧设备）。

---

## 六、已知限制

1. **只支持栅格底图**。官方底图是 `@versatiles/style` 生成的 Shortbread 矢量样式，换成别的矢量源等于重做整套配色与字体，不在这个补丁的量级。
2. **`map_style` 对国内底图无效**。栅格瓦片没有图层可改色，这是能力差异不是 Bug。
3. **高德不纠偏**。GCJ-02 与 WGS84 差数百米；补丁故意不处理，纠偏会把复杂度塞回 HA。要纠偏请用 `map-cn.js`。
4. **天地图 Key 前端可见**。设计使然，任何能打开看板的人都能从网络请求拿到。
5. **每次升级 HA 要重打**。版本跨度大时需要处理冲突。

---

## 七、向上游提交的路径

如果想让官方原生支持，顺序是：

1. 在 `home-assistant/architecture` 提议题，说清动机（网络受限地区、离线部署、隐私）；
2. 说明 OSMF 政策边界（不得鼓励批量抓取、需自定义版权声明与缓存策略）；
3. PR 大概率会被要求收敛范围：只做 raster 源、配置进 `map_tiles` 集成而非卡片、默认关闭。

本补丁的 `basemap.ts` 就是按这个思路写的，可以直接当 PR 原型。
