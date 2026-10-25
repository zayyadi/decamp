import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { Objects, Topology } from "topojson-specification";
import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";

// Builds public/maps/ng-states.topo.json from geoBoundaries' Nigeria ADM1
// file (GRID3, 2022, CC BY 4.0; attribution in components/map/state-map.tsx):
//   npm run build-map -- <geoBoundaries-NGA-ADM1_simplified.geojson>
// Source used: github.com/wmgeolab/geoBoundaries, commit 9469f09.

const root = join(import.meta.dirname, "..");
const OUT = join(root, "public", "maps", "ng-states.topo.json");

// geoBoundaries names that differ from public.ng_states.
const RENAME: Record<string, string> = { "Abuja Federal Capital Territory": "FCT" };

// Keep enough detail for state outlines at dashboard size; the file drops from ~800 KB to ~60 KB.
const KEEP = 0.12;

/** Twice the planar signed area of a ring in lon/lat; positive means counter-clockwise. */
function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return sum;
}

/**
 * GeoJSON (RFC 7946) winds outer rings counter-clockwise; d3-geo, which
 * react-simple-maps uses, reads that as the rest of the globe and fills the
 * whole map. Rewind to d3's order: outer rings clockwise, holes counter-clockwise.
 */
export function rewindForD3(geometry: Geometry): Geometry {
  const polygon = (rings: Position[][]) =>
    rings.map((ring, i) => {
      const clockwise = signedArea(ring) < 0;
      return (i === 0) === clockwise ? ring : [...ring].reverse();
    });
  if (geometry.type === "Polygon") return { ...geometry, coordinates: polygon(geometry.coordinates) };
  if (geometry.type === "MultiPolygon") return { ...geometry, coordinates: geometry.coordinates.map(polygon) };
  return geometry;
}

export function stateNames(): string[] {
  const sql = readFileSync(join(root, "supabase", "migrations", "20261024000001_core_schema.sql"), "utf8");
  const block = sql.slice(sql.indexOf("insert into public.ng_states"), sql.indexOf("insert into public.parties"));
  return [...block.matchAll(/\('([^']+)',/g)].map((m) => m[1]);
}

function main(): number {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npm run build-map -- <geoBoundaries-NGA-ADM1_simplified.geojson>");
    return 1;
  }
  const source = JSON.parse(readFileSync(input, "utf8")) as FeatureCollection<Geometry, { shapeName?: string }>;
  const expected = new Set(stateNames());
  const features = source.features.map((f): Feature<Geometry, { name: string }> => {
    const raw = f.properties?.shapeName ?? "";
    const name = RENAME[raw] ?? raw;
    if (!expected.delete(name)) throw new Error(`unknown or duplicate state in the source: "${raw}"`);
    return { type: "Feature", geometry: rewindForD3(f.geometry), properties: { name } };
  });
  if (expected.size) throw new Error(`missing from the source: ${[...expected].join(", ")}`);

  const states: FeatureCollection<Geometry, { name: string }> = { type: "FeatureCollection", features };
  // The server typings drop property types; every feature carries `name`.
  let topo = topology({ states }, 1e5) as Topology<Objects<{ name: string }>>;
  topo = presimplify(topo);
  topo = simplify(topo, quantile(topo, KEEP));
  writeFileSync(OUT, JSON.stringify(topo));
  console.log(`wrote ${OUT}: ${features.length} states, ${(JSON.stringify(topo).length / 1024).toFixed(0)} KB`);
  return 0;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) process.exit(main());
