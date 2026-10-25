"use client";

import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip, type SankeyLinkProps, type SankeyNodeProps } from "recharts";
import { formatNumber } from "@/lib/format";
import { partyColor } from "@/lib/parties";
import type { Flow } from "@/lib/queries/dashboard";

interface FlowNode {
  name: string;
  code: string;
  side: "from" | "to";
  total: number;
}

/** Origin parties on the left, destinations on the right; a party can appear on both sides. */
export function buildSankey(flows: Flow[]) {
  const nodes: FlowNode[] = [];
  const index = new Map<string, number>();
  const node = (code: string, side: FlowNode["side"], value: number) => {
    const key = `${side}:${code}`;
    let i = index.get(key);
    if (i === undefined) {
      i = nodes.push({ name: `${code} (${side})`, code, side, total: 0 }) - 1;
      index.set(key, i);
    }
    nodes[i].total += value;
    return i;
  };
  const links = flows.map((f) => ({
    source: node(f.from_code, "from", f.defections),
    target: node(f.to_code, "to", f.defections),
    value: f.defections,
  }));
  return { nodes, links };
}

export function PartyFlows({ flows }: { flows: Flow[] }) {
  const data = buildSankey(flows);
  const height = Math.max(240, Math.min(480, data.nodes.length * 36));

  const renderNode = ({ x, y, width, height: h, index }: SankeyNodeProps) => {
    const n = data.nodes[index];
    const left = n.side === "from";
    return (
      <Layer key={`node-${index}`}>
        <Rectangle x={x} y={y} width={width} height={h} fill={partyColor(n.code)} radius={3} />
        <text
          x={left ? x - 8 : x + width + 8}
          y={y + h / 2}
          textAnchor={left ? "end" : "start"}
          dominantBaseline="middle"
          className="fill-foreground text-xs font-semibold"
        >
          {n.code}
          <tspan className="fill-muted-foreground font-normal"> {n.total}</tspan>
        </text>
      </Layer>
    );
  };

  // Each band takes its origin party's colour, so it reads in both themes.
  const renderLink = ({ sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, index }: SankeyLinkProps) => {
    const from = data.nodes[data.links[index].source];
    return (
      <path
        key={`link-${index}`}
        d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
        fill="none"
        stroke={partyColor(from.code)}
        strokeWidth={Math.max(1, linkWidth)}
        strokeOpacity={0.35}
        className="transition-[stroke-opacity] hover:[stroke-opacity:0.6]"
      />
    );
  };

  return (
    <figure className="space-y-2">
      <div className="flex justify-between px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase" aria-hidden>
        <span>Left</span>
        <span>Joined</span>
      </div>
      <div style={{ height }} role="img" aria-label="Party flows: see the table below for the numbers">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={data}
            node={renderNode}
            nodePadding={18}
            nodeWidth={12}
            margin={{ top: 8, right: 72, bottom: 8, left: 72 }}
            link={renderLink}
          >
            <Tooltip
              formatter={(value) => [formatNumber(Number(value)), "Defections"]}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)" }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
