// map-cn-strategy：中国地图仪表盘 dashboard strategy 注册
// 对齐官方 map-dashboard-strategy（src/panels/lovelace/strategies/map/map-dashboard-strategy.ts）：
// - window.customStrategies 注册（type: map-cn, strategyType: dashboard）→「设置→仪表盘→添加仪表盘」对话框出现「中国地图」
// - custom element ll-strategy-dashboard-map-cn：generate() 返回 LovelaceConfig
// 用户在 UI 里创建仪表盘，全程无需写代码；卡片类型为 map-cn（国内瓦片），配置与官方 map 一致。

export const registerMapCnDashboardStrategy = () => {
  // 1) 对话框条目（与官方 CustomStrategyEntry 一致）
  const win = typeof window !== "undefined" ? window : undefined;
  if (!win) {
    return;
  }
  if (!("customStrategies" in win)) {
    win.customStrategies = [];
  }
  const exists = win.customStrategies.some(
    (s) => s.type === "map-cn" && s.strategyType === "dashboard"
  );
  if (!exists) {
    win.customStrategies.push({
      type: "map-cn",
      name: "中国地图",
      description: "中国版地图仪表盘：国内可达的高德/腾讯/天地图底图，功能与官方地图仪表盘一致（人/设备/区域、活动时间线、轨迹、聚合）",
      documentationURL: "https://github.com/RockJesus/ha-map-cn",
      strategyType: "dashboard",
    });
  }

  // 2) strategy 实现（custom element，tag 规则 ll-strategy-<configType>-<name>）
  if (customElements.get("ll-strategy-dashboard-map-cn")) {
    return;
  }
  class MapCnDashboardStrategy extends HTMLElement {
    // 官方 registryDependencies（entities/devices/areas/floors）——本卡片直接读 hass.states，无需依赖
    static registryDependencies = [];

    // 与官方 map-dashboard-strategy.generate 同构：panel 视图 + 地图卡片（auto_fit/show_all）
    static async generate(config, hass) {
      return {
        views: [
          {
            type: "panel",
            title: "中国地图",
            icon: "mdi:map",
            cards: [
              {
                type: "map-cn",
                auto_fit: true,
                show_all: true,
              },
            ],
          },
        ],
      };
    }

    static noEditor = true;

    // 与官方 getCreateSuggestions 一致：仪表盘列表里的创建建议
    static getCreateSuggestions() {
      return { title: "中国地图", icon: "mdi:map" };
    }
  }
  customElements.define("ll-strategy-dashboard-map-cn", MapCnDashboardStrategy);
};
