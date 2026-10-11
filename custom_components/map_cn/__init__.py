"""中国版地图卡片（map_cn）。

HA 官方地图卡片在中国的底图瓦片源（OSM 等）不可达导致地图空白；
本组件注册一个功能与官方一致的「中国地图卡片」（map-cn-card，类型 map-cn），
默认使用高德/腾讯/天地图等国内可达底图，并自动处理 WGS-84 <-> GCJ-02 坐标转换。

纯前端卡片，无配置流、无实体，通过 frontend.add_extra_js_url 注入模块脚本。
"""

from __future__ import annotations

from homeassistant.components import frontend
from homeassistant.const import EVENT_COMPONENT_LOADED
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.typing import ConfigType

DOMAIN = "map_cn"
CARD_URL = "/map_cn/map-cn.js"
STATIC_PATH = "/map_cn"


@callback
def _register_card(hass: HomeAssistant) -> None:
    """把卡片脚本注册为前端模块资源。"""
    frontend.add_extra_js_url(hass, CARD_URL)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the China map card."""
    www = hass.config.path("custom_components", DOMAIN, "www")
    hass.http.register_static_path(STATIC_PATH, www, cache_headers=True)

    if "frontend" in hass.config.components:
        _register_card(hass)
    else:

        @callback
        def _frontend_loaded(event) -> None:
            if event.data.get("component") == "frontend":
                _register_card(hass)

        hass.bus.async_listen_once(EVENT_COMPONENT_LOADED, _frontend_loaded)

    return True
