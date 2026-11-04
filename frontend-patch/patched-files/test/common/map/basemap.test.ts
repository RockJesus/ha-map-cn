import { describe, expect, it } from "vitest";
import {
  basemapFromCardConfig,
  basemapLayers,
  expandBasemapTemplate,
  normalizeBasemapConfig,
  resolveBasemapProvider,
} from "../../../src/common/map/basemap";

// The one property everything else depends on: an instance that configures
// nothing must take exactly the upstream path, or this patch changes behaviour
// for people who never asked for it.

describe("resolveBasemapProvider", () => {
  it("stays on OSM without a configuration", () => {
    expect(resolveBasemapProvider(undefined)).toBe("osm");
  });

  it("stays on OSM for auto without a key", () => {
    expect(resolveBasemapProvider({ provider: "auto" })).toBe("osm");
  });

  it("picks Tianditu for auto once a key is set", () => {
    expect(
      resolveBasemapProvider({ provider: "auto", tianditu_key: "KEY" })
    ).toBe("tianditu");
  });
});

describe("basemapLayers", () => {
  it("returns undefined when the native base map stays", () => {
    expect(basemapLayers(undefined)).toBeUndefined();
    expect(basemapLayers({ provider: "osm" })).toBeUndefined();
  });

  it("returns undefined for custom without a template", () => {
    expect(basemapLayers({ provider: "custom" })).toBeUndefined();
  });

  it("draws Tianditu as a base and a label layer", () => {
    const layers = basemapLayers({ provider: "tianditu", tianditu_key: "KEY" })!;
    expect(layers).toHaveLength(2);
    expect(layers[0].url).toContain("T=vec_w");
    expect(layers[1].url).toContain("T=cva_w");
    expect(layers[0].url).toContain("tk=KEY");
    expect(layers[0].maxZoom).toBe(18);
  });

  it("draws the satellite pair when asked", () => {
    const layers = basemapLayers({
      provider: "tianditu-satellite",
      tianditu_key: "K",
    })!;
    expect(layers[0].url).toContain("img_w");
    expect(layers[1].url).toContain("cia_w");
  });

  it("keeps AMap to a single layer with a subdomain", () => {
    const layers = basemapLayers({ provider: "amap" })!;
    expect(layers).toHaveLength(1);
    expect(layers[0].url).toContain("webrd0{s}");
  });

  it("passes a custom source through", () => {
    const layers = basemapLayers({
      provider: "custom",
      tile_url: "http://10.0.0.2/{z}/{x}/{y}.png",
      attribution: "© me",
      max_zoom: 19,
    })!;
    expect(layers[0].maxZoom).toBe(19);
    expect(layers[0].attribution).toBe("© me");
  });
});

describe("expandBasemapTemplate", () => {
  it("offers Tianditu its eight shards", () => {
    expect(
      expandBasemapTemplate("{s}/x", { provider: "tianditu" }).subdomains
    ).toBe("01234567");
  });

  it("fills the key", () => {
    expect(
      expandBasemapTemplate("a/{key}/b", {
        provider: "custom",
        tianditu_key: "K",
      }).template
    ).toBe("a/K/b");
  });
});

describe("basemapFromCardConfig", () => {
  it("stays native for an explicit osm", () => {
    expect(basemapFromCardConfig({ basemap: "osm" })).toBeUndefined();
  });

  it("stays native for an empty config", () => {
    expect(basemapFromCardConfig({})).toBeUndefined();
  });

  it("resolves auto through the same rule", () => {
    expect(basemapFromCardConfig({ basemap_tianditu_key: "K" })?.provider).toBe(
      "auto"
    );
    expect(basemapLayers(basemapFromCardConfig({ basemap_tianditu_key: "K" })))
      .toHaveLength(2);
  });
});

describe("normalizeBasemapConfig", () => {
  it("drops the default so the editor does not write it back", () => {
    expect(normalizeBasemapConfig({ basemap: "auto" }).basemap).toBeUndefined();
  });

  it("keeps a real choice", () => {
    expect(normalizeBasemapConfig({ basemap: "tianditu" }).basemap).toBe(
      "tianditu"
    );
  });
});
