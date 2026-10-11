"""中国地图卡片（China Map Card）：安装即自动注册仪表盘前端资源。

纯前端卡片（内置高德/腾讯/天地图/OSM 底图，功能对齐官方地图卡片）。
本集成不产生任何实体/配置项，仅负责把打包好的卡片 JS 注册为仪表盘资源，
URL 路径固定为 /ha-map-cn/map-cn.js（对应集成内 www/ 目录）。
"""
import logging

from homeassistant.core import HomeAssistant

from homeassistant.components import frontend

_LOGGER = logging.getLogger(__name__)

DOMAIN = "map_cn"
_JS_PATH = "/ha-map-cn/map-cn.js"


def async_setup(hass: HomeAssistant, config):
    """安装时自动注册卡片 JS 为仪表盘资源（刷新浏览器即可用，无需手动添加资源）。"""
    www_dir = hass.config.path("custom_components", DOMAIN, "www")
    try:
        hass.http.register_static_path(_JS_PATH.rsplit("/", 1)[0], www_dir, cache_headers=False)
    except Exception as err:  # pragma: no cover
        _LOGGER.warning("register_static_path failed: %s", err)
    frontend.async_add_extra_js_url(hass, _JS_PATH)
    _LOGGER.info("China Map Card resource registered: %s", _JS_PATH)
    return True
