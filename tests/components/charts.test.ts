import { readFileSync } from "node:fs";
import { join } from "node:path";
import { geoArea } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { describe, expect, it } from "vitest";
import { buildSankey } from "@/components/charts/party-flows";
import { shade } from "@/components/map/state-map";
import { rewindForD3, stateNames } from "@/scripts/build-map";

describe("buildSankey", () => {
  it("keeps origin and destination nodes apart, so a party can be on both sides", () => {
    const { nodes, links } = buildSankey([
      { from_code: "PDP", to_code: "APC", defections: 3 },
      { from_code: "APC", to_code: "PDP", defections: 1 },
      { from_code: "LP", to_code: "APC", defections: 2 },
    ]);
    expect(nodes.map((n) => [n.code, n.side, n.total])).toEqual([
      ["PDP", "from", 3],
      ["APC", "to", 5],
      ["APC", "from", 1],
      ["PDP", "to", 1],
      ["LP", "from", 2],
    ]);
    expect(links).toEqual([
      { source: 0, target: 1, value: 3 },
      { source: 2, target: 3, value: 1 },
      { source: 4, target: 1, value: 2 },
    ]);
  });
});

describe("map shading", () => {
  it("leaves empty states unshaded and scales the rest from 25% to 100%", () => {
    expect(shade(0, 10)).toBe(0);
    expect(shade(0, 0)).toBe(0);
    expect(shade(1, 1)).toBe(100);
    expect(shade(5, 10)).toBe(63);
  });
});

describe("state boundaries", () => {
  it("cover every state in ng_states exactly once", () => {
    const topo = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "..", "public", "maps", "ng-states.topo.json"), "utf8"),
    ) as Topology<{ states: GeometryCollection<{ name: string }> }>;
    const names = feature(topo, topo.objects.states).features.map((f) => f.properties.name);
    expect(names.sort()).toEqual(stateNames().sort());
  });

  it("are wound the way d3 expects, so no state covers the globe", () => {
    const topo = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "..", "public", "maps", "ng-states.topo.json"), "utf8"),
    ) as Topology<{ states: GeometryCollection<{ name: string }> }>;
    // Nigeria is about 0.023 steradians; a wrongly wound state measures nearly 4π.
    for (const f of feature(topo, topo.objects.states).features) expect(geoArea(f), f.properties.name).toBeLessThan(0.01);
  });

  it("rewinds a counter-clockwise outer ring", () => {
    const ccw = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    const fixed = rewindForD3(ccw);
    expect(geoArea({ type: "Feature", properties: {}, geometry: ccw })).toBeGreaterThan(12);
    expect(geoArea({ type: "Feature", properties: {}, geometry: fixed })).toBeLessThan(0.001);
  });
});
