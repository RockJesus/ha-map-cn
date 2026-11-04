// Domestic (China mainland) basemap providers for the Home Assistant map.
//
// Why this exists: since 2026.9 every map draws OSMF "Shortbread" vector tiles,
// and the browser can only reach them through the `map_tiles` proxy on the
// instance. When that instance cannot reach vector.openstreetmap.org, every map
// renders blank - on the phone too, because the tile traffic leaves from the
// server, not the device.
//
// This adds a provider switch that replaces the raster tile source only.
// Markers, zones, trails, clustering, the Map dashboard and the zone editor all
// keep working: they are drawn on top of the base layer and never touch it.
//
// Providers are Raster XYZ templates. Vector providers are not attempted:
// mixing a foreign vector style with HA's own overlays means writing a style
// from scratch and shipping it, which is a fork of @versatiles/style.
//
// Do not point these at OSMF: their Tile Usage Policy forbids bulk use and
// requires a Referer that a browser cannot be trusted to send, which is the
// very reason the server-side proxy exists.

export type BasemapProviderId =
  | "auto"
  | "osm"
  | "tianditu"
  | "tianditu-satellite"
  | "amap"
  | "custom";

/** One layer of a raster provider; labels ride on a second layer */
export interface BasemapTileLayer {
  /** XYZ template; may contain {s} for a subdomain */
  url: string;
  attribution: string;
  maxZoom: number;
  minZoom: number;
}

export interface BasemapProviderConfig {
  provider: BasemapProviderId;
  /** Tianditu key from https://console.tianditu.gov.cn/ */
  tianditu_key?: string;
  /** Overrides the provider's template; used by `custom` */
  tile_url?: string;
  /** Required with tile_url; the provider's own is used otherwise */
  attribution?: string;
  /** Highest level the source has tiles for; defaults to 18 */
  max_zoom?: number;
}

/** Providers the card editor offers, in order */
export const BASEMAP_PROVIDERS: BasemapProviderId[] = [
  "auto",
  "osm",
  "tianditu",
  "tianditu-satellite",
  "amap",
  "custom",
];

export const DEFAULT_BASEMAP_MAX_ZOOM = 18;

const TIANDITU_SUBDOMAINS = "01234567";
const AMAP_SUBDOMAINS = "01234";

const TIANDITU_ATTRIBUTION = "© 天地图";

const tiandituUrl = (key: string | undefined, type: string) =>
  `https://t{s}.tianditu.gov.cn/DataServer?T=${type}&x={x}&y={y}&l={z}&tk=${key ?? ""}`;

/**
 * Which provider a configuration asks for, with `auto` resolved. `auto` means
 * Tianditu once a key is configured, and the native OSM base map otherwise, so
 * an instance that never sets a key behaves exactly as before.
 */
export const resolveBasemapProvider = (
  config: BasemapProviderConfig | undefined
): Exclude<BasemapProviderId, "auto"> => {
  const provider = config?.provider ?? "auto";
  if (provider !== "auto") {
    return provider;
  }
  return config?.tianditu_key ? "tianditu" : "osm";
};

/**
 * Layers to draw, or `undefined` when the native base map stays in place and
 * the existing vector/raster path should run untouched.
 */
export const basemapLayers = (
  config: BasemapProviderConfig | undefined
): BasemapTileLayer[] | undefined => {
  const provider = resolveBasemapProvider(config);
  const maxZoom = config?.max_zoom ?? DEFAULT_BASEMAP_MAX_ZOOM;
  const minZoom = 3;

  if (provider === "osm") {
    return undefined;
  }

  if (provider === "custom") {
    if (!config?.tile_url) {
      return undefined;
    }
    return [
      {
        url: config.tile_url,
        attribution: config.attribution ?? "",
        maxZoom,
        minZoom,
      },
    ];
  }

  if (provider === "amap") {
    return [
      {
        url: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
        attribution: "© 高德地图",
        maxZoom,
        minZoom,
      },
    ];
  }

  const satellite = provider === "tianditu-satellite";
  return [
    {
      url: tiandituUrl(config?.tianditu_key, satellite ? "img_w" : "vec_w"),
      attribution: satellite
        ? `${TIANDITU_ATTRIBUTION} 影像`
        : TIANDITU_ATTRIBUTION,
      maxZoom,
      minZoom,
    },
    {
      url: tiandituUrl(config?.tianditu_key, satellite ? "cia_w" : "cva_w"),
      attribution: "",
      maxZoom,
      minZoom,
    },
  ];
};

/** Leaflet's `{s}` subdomains for a provider */
export const basemapSubdomains = (
  config?: BasemapProviderConfig
): string => {
  const provider = resolveBasemapProvider(config);
  return provider === "tianditu" || provider === "tianditu-satellite"
    ? TIANDITU_SUBDOMAINS
    : AMAP_SUBDOMAINS;
};

/**
 * Fills `{key}` into a template and returns the `{s}` set for Leaflet to
 * substitute. MapLibre has no subdomains: it gets the first shard, which for
 * an XYZ mirror serves the same tiles.
 */
export const expandBasemapTemplate = (
  template: string,
  config?: BasemapProviderConfig
): { template: string; subdomains: string } => ({
  template: template.replace("{key}", config?.tianditu_key ?? ""),
  subdomains: basemapSubdomains(config),
});

/** The template with `{s}` resolved to one shard, for MapLibre's tile list */
export const singleShardTemplate = (
  template: string,
  subdomains: string
): string => template.replace("{s}", subdomains[0]);

/**
 * A card config as a provider config, or `undefined` when the native base map
 * stays. One place decides what "auto" means, so the card and its editor agree.
 */
export const basemapFromCardConfig = (config: {
  basemap?: BasemapProviderId;
  basemap_tianditu_key?: string;
  basemap_tile_url?: string;
  basemap_attribution?: string;
  basemap_max_zoom?: number;
}): BasemapProviderConfig | undefined => {
  const providerConfig: BasemapProviderConfig = {
    provider: config.basemap ?? "auto",
    tianditu_key: config.basemap_tianditu_key,
    tile_url: config.basemap_tile_url,
    attribution: config.basemap_attribution,
    max_zoom: config.basemap_max_zoom,
  };
  return resolveBasemapProvider(providerConfig) === "osm"
    ? undefined
    : providerConfig;
};

/**
 * Drops the basemap keys that are at their default, so an editor round trip
 * does not write `basemap: auto` onto every card it touches.
 */
export const normalizeBasemapConfig = <T extends Record<string, unknown>>(
  config: T
): T => {
  if (!config.basemap || config.basemap === "auto") {
    delete config.basemap;
  }
  return config;
};
