// Hand-drawn line-art icons for every architecture node type.
// Feather/Lucide house style: 24x24 grid, 1.6 stroke, currentColor, no fills,
// no text glyphs, no randomness. Each icon must stay legible at 18px.
import type { JSX, ReactNode } from 'react';
import type { ArchNodeType } from '@loadbearing/shared';

/** The one and only <svg> shell — keeps every icon on the same optical grid. */
function Glyph({ size = 18, children }: { size?: number; children: ReactNode }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const NODE_ICONS: Record<ArchNodeType, (props: { size?: number }) => JSX.Element> = {
  // ---------- Edge & traffic ----------

  /** Browser window: chrome bar, two window dots, a little content. */
  client: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M2.5 8.5h19" />
      <path d="M5.4 6.25h.01M7.9 6.25h.01" />
      <path d="M6 12h9M6 16h6" />
    </Glyph>
  ),

  /** Phone: tall rounded slab, earpiece slit, home bar. */
  mobile_client: ({ size }) => (
    <Glyph size={size}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M10 5.2h4" />
      <path d="M10.5 18.8h3" />
    </Glyph>
  ),

  /** Signpost: one post, two direction plates pointing opposite ways. */
  dns: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 2.5v19" />
      <path d="M12 5.5h6l2.5 2.5L18 10.5h-6" />
      <path d="M12 13.5H6l-2.5 2.5L6 18.5h6" />
    </Glyph>
  ),

  /** Globe with edge arcs radiating out on both sides. */
  cdn: ({ size }) => (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="5" />
      <path d="M7 12h10" />
      <ellipse cx="12" cy="12" rx="2.4" ry="5" />
      <path d="M18.6 7.6a7 7 0 0 1 0 8.8" />
      <path d="M5.4 16.4a7 7 0 0 1 0-8.8" />
    </Glyph>
  ),

  /** One inbound arrow fanned out into three downstream arrows. */
  load_balancer: ({ size }) => (
    <Glyph size={size}>
      <path d="M2 12h7" />
      <path d="M9 5v14" />
      <path d="M9 5h5.5M9 12h5.5M9 19h5.5" />
      <path d="M14.5 3.2 17 5l-2.5 1.8M14.5 10.2 17 12l-2.5 1.8M14.5 17.2 17 19l-2.5 1.8" />
    </Glyph>
  ),

  /** Gate/portal — two pillars under an arch, with a request passing through. */
  api_gateway: ({ size }) => (
    <Glyph size={size}>
      <path d="M6 21V8M18 21V8" />
      <path d="M6 8a6 6 0 0 1 12 0" />
      <path d="M4 21h16" />
      <path d="M2.5 14.5h19m-3.2-3.2 3.2 3.2-3.2 3.2" />
    </Glyph>
  ),

  /** Funnel with a pressure gauge — traffic squeezed to a fixed rate. */
  rate_limiter: ({ size }) => (
    <Glyph size={size}>
      <path d="M3 5h14l-5.5 6.5v6.5l-3 1.5v-8z" />
      <circle cx="18" cy="17" r="3.6" />
      <path d="M18 17l2-2.2" />
    </Glyph>
  ),

  /** Plug socket with traffic flowing both ways — a duplex channel. */
  websocket_gw: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="8" width="5" height="8" rx="1.5" />
      <path d="M7.5 10.5h2M7.5 13.5h2" />
      <path d="M11 8h9m-2.6-2.5L20 8l-2.6 2.5" />
      <path d="M20 16h-9m2.6-2.5L11 16l2.6 2.5" />
    </Glyph>
  ),

  /** Shield standing on a brick wall — inspection at the perimeter. */
  waf: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 2 18 4.1v3.9c0 3.2-2.4 5.4-6 6.4-3.6-1-6-3.2-6-6.4V4.1z" />
      <rect x="2.5" y="15.5" width="19" height="6" rx="0.8" />
      <path d="M2.5 18.5h19" />
      <path d="M9 15.5v3M15 15.5v3M6 18.5v3M12 18.5v3M18 18.5v3" />
    </Glyph>
  ),

  /** A request bouncing off a vertical plane that hides the origin behind it. */
  reverse_proxy: ({ size }) => (
    <Glyph size={size}>
      <path d="M15 2.5v19" />
      <path d="M3 6 13.8 11.4" />
      <path d="M13.8 12.6 3 18" />
      <path d="M5.7 16.6 3 18l1.2 2.6" />
      <rect x="18" y="9.5" width="4" height="5" rx="1" />
    </Glyph>
  ),

  /** One client fanning into the two services it stitches together. */
  bff: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="9" width="5.5" height="6" rx="1.5" />
      <path d="M8 12h3.5M11.5 6.5v11M11.5 6.5h3M11.5 17.5h3" />
      <rect x="14.5" y="3.5" width="6.5" height="6" rx="1.5" />
      <rect x="14.5" y="14.5" width="6.5" height="6" rx="1.5" />
    </Glyph>
  ),

  /** A rosette: one queryable graph of nodes and edges behind a single endpoint. */
  graphql_gateway: ({ size }) => (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="4" r="1.5" />
      <circle cx="19" cy="17" r="1.5" />
      <circle cx="5" cy="17" r="1.5" />
      <path d="M12 6v4M13.7 13.2 17.4 15.9M10.3 13.2 6.6 15.9" />
      <path d="M13.2 5.3 18 15.1M10.8 5.3 6 15.1M6.5 17.5h11" />
    </Glyph>
  ),

  /** A lattice of services wired to each other, plus the sidecar doing the wiring. */
  service_mesh: ({ size }) => (
    <Glyph size={size}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="16" r="2" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="15" cy="16" r="2" />
      <path d="M8 6h5M6 8v6M8 16h5M15 8v6M7.5 7.5 13.5 14.5" />
      <rect x="17.5" y="14" width="4.5" height="4.5" rx="1" />
    </Glyph>
  ),

  /** A globe with a branching arrow leaving it — same name, nearest region. */
  geo_router: ({ size }) => (
    <Glyph size={size}>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M2.5 9h13" />
      <ellipse cx="9" cy="9" rx="2.8" ry="6.5" />
      <path d="M9 15.5v3.5h11" />
      <path d="M17.8 16.8 20.8 19l-3 2.2" />
    </Glyph>
  ),

  /** A battlemented tower plus a key — the one guarded door for human access. */
  bastion: ({ size }) => (
    <Glyph size={size}>
      <path d="M7 21V4h1.8v1.6h1.8V4h1.8v1.6h1.8V4H15v17" />
      <path d="M4.5 21.2h13" />
      <path d="M9.5 12h3M9.5 15.5h3" />
      <circle cx="19.2" cy="9.5" r="2.1" />
      <path d="M19.2 11.6v6.4M19.2 15.2h2" />
    </Glyph>
  ),

  // ---------- Compute ----------

  /** Hexagon with a port in the middle and wires on both sides. */
  service: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M4.5 12h5M14.5 12h5" />
    </Glyph>
  ),

  /** One big block with internal seams — everything in a single deployable. */
  monolith: ({ size }) => (
    <Glyph size={size}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M4 9h16M4 15h16" />
      <path d="M12 15v6" />
    </Glyph>
  ),

  /** Lambda mark inside a box — code with no server of its own. */
  serverless_fn: ({ size }) => (
    <Glyph size={size}>
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <path d="M8 7.5h2.2l4.3 9" />
      <path d="M12.4 12.2 8.4 16.5" />
    </Glyph>
  ),

  /** A lambda inside a slice of globe — your code running in the edge PoP. */
  edge_function: ({ size }) => (
    <Glyph size={size}>
      <path d="M9.5 3a9.5 9.5 0 0 0 0 18" />
      <path d="M9.5 6.5a6 6 0 0 0 0 11" />
      <path d="M12.5 7.5h2l4 9" />
      <path d="M16.9 12.6 13 16.5" />
    </Glyph>
  ),

  /** Containers stacked by a control ring that decides where each one runs. */
  container_platform: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="14" width="8" height="6.5" rx="1.2" />
      <rect x="11.5" y="14" width="8" height="6.5" rx="1.2" />
      <rect x="7" y="6.5" width="8" height="6.5" rx="1.2" />
      <circle cx="19" cy="4.8" r="2.8" />
      <path d="M19 4.8h.01" />
    </Glyph>
  ),

  /** A machine with a guest machine inside it. */
  vm: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <rect x="7" y="7" width="10" height="6" rx="1" />
      <path d="M12 16.5v3.5M9 20h6" />
    </Glyph>
  ),

  /** A stack of work items and the arrow that runs the whole pile at once. */
  batch_job: ({ size }) => (
    <Glyph size={size}>
      <path d="M6.5 4.5h9.5v2" />
      <path d="M4.8 6.8h9.5v2" />
      <rect x="3" y="9" width="11.5" height="11" rx="1.5" />
      <path d="M6 12.5h5.5M6 16h3.5" />
      <path d="M16.5 12.5 21 15.2l-4.5 2.7z" />
    </Glyph>
  ),

  /** Box with an arrow leaving it — something you call but do not own. */
  third_party: ({ size }) => (
    <Glyph size={size}>
      <path d="M20 12.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6.5" />
      <path d="M15 3.5h5.5V9" />
      <path d="M20.5 3.5 12.5 11.5" />
    </Glyph>
  ),

  /** Five inbound wires squeezed into two outbound ones. */
  connection_pooler: ({ size }) => (
    <Glyph size={size}>
      <path d="M2.5 3.5h4M2.5 7.5h4M2.5 12h4M2.5 16.5h4M2.5 20.5h4" />
      <path d="M6.5 3.5 11.5 10M6.5 7.5 11.5 10.6M6.5 12h5M6.5 16.5 11.5 13.4M6.5 20.5 11.5 14" />
      <rect x="11.5" y="8.5" width="3.5" height="7" rx="1.2" />
      <path d="M15 11h6.5M15 13h6.5" />
    </Glyph>
  ),

  /** A container with a smaller helper container clipped to its flank. */
  sidecar: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="5" width="12.5" height="14" rx="2" />
      <path d="M6 9.5h6M6 13h6M6 16h3.5" />
      <rect x="15" y="8.5" width="6.5" height="7" rx="1.5" />
      <path d="M17 12h2.5" />
    </Glyph>
  ),

  // ---------- Data ----------

  /** Lightning over a two-layer stack — memory-speed reads. */
  cache: ({ size }) => (
    <Glyph size={size}>
      <path d="M13.6 2.6 8.8 11.2h3.4l-1.2 4 4.6-7.6h-3.4z" />
      <rect x="3.5" y="16" width="17" height="2.5" rx="1.2" />
      <rect x="3.5" y="19.5" width="17" height="2.5" rx="1.2" />
    </Glyph>
  ),

  /** The classic three-disc cylinder. */
  sql_db: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.75" />
      <path d="M4.5 5.5v13a7.5 2.75 0 0 0 15 0v-13" />
      <path d="M4.5 10.5a7.5 2.75 0 0 0 15 0" />
      <path d="M4.5 15a7.5 2.75 0 0 0 15 0" />
    </Glyph>
  ),

  /** Cylinder holding scattered documents instead of neat rows. */
  nosql_db: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.75" />
      <path d="M4.5 6v12a7.5 2.75 0 0 0 15 0V6" />
      <path d="M8.4 12.6h.01M11.8 15h.01M15.4 11.4h.01M11.2 10.4h.01" />
    </Glyph>
  ),

  /** A bucket — dump bytes in, get a URL back. */
  blob_store: ({ size }) => (
    <Glyph size={size}>
      <path d="M3 6.5h18" />
      <path d="M4.8 6.5 6.4 20.1a1.6 1.6 0 0 0 1.6 1.4h8a1.6 1.6 0 0 0 1.6-1.4L19.2 6.5" />
      <path d="M8.5 6.5a3.5 3.5 0 0 1 7 0" />
      <path d="M6.1 13h11.8" />
    </Glyph>
  ),

  /** Magnifier over indexed lines. */
  search_index: ({ size }) => (
    <Glyph size={size}>
      <path d="M3 6h11M3 10.5h7M3 15h5" />
      <circle cx="15.5" cy="14.5" r="4" />
      <path d="M18.4 17.4 21.5 20.5" />
    </Glyph>
  ),

  /** A second cylinder fed by a copy arrow from the first. */
  read_replica: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="6.5" cy="4.5" rx="4" ry="1.8" />
      <path d="M2.5 4.5v6a4 1.8 0 0 0 8 0v-6" />
      <ellipse cx="17.5" cy="12.5" rx="4" ry="1.8" />
      <path d="M13.5 12.5v6a4 1.8 0 0 0 8 0v-6" />
      <path d="M11 8.4 14.8 11.4m-.3-2 .3 2-2 .3" />
    </Glyph>
  ),

  /** A warehouse roof over a cylinder — one place all the data lands. */
  data_warehouse: ({ size }) => (
    <Glyph size={size}>
      <path d="M2.5 8.8 12 3.2l9.5 5.6" />
      <path d="M4.5 8.8v1.6M19.5 8.8v1.6" />
      <ellipse cx="12" cy="13" rx="6" ry="2.1" />
      <path d="M6 13v5.5a6 2.1 0 0 0 12 0V13" />
    </Glyph>
  ),

  /** A cube sliced into cells — dimensions you slice and aggregate. */
  olap_db: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 2.8 20.6 7.6v8.8L12 21.2l-8.6-4.8V7.6z" />
      <path d="M12 12.2v9M12 12.2 3.4 7.6M12 12.2l8.6-4.6" />
      <path d="M7.7 5.2 16.3 10M16.3 5.2 7.7 10" />
      <path d="M12 16.7 3.4 12M12 16.7l8.6-4.7" />
    </Glyph>
  ),

  /** A cylinder holding a sawtooth of measurements over time. */
  timeseries_db: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.75" />
      <path d="M4.5 6v12a7.5 2.75 0 0 0 15 0V6" />
      <path d="M7 15.5 9.5 11l2.5 3.5 2.5-5 2.5 4" />
    </Glyph>
  ),

  /** Nodes joined by edges — the relationship is the record. */
  graph_db: ({ size }) => (
    <Glyph size={size}>
      <circle cx="6" cy="7" r="2.6" />
      <circle cx="18" cy="9" r="2.6" />
      <circle cx="11" cy="18" r="2.6" />
      <path d="M8.5 7.4 15.5 8.4M7 9.4l3 6M16.4 11.3 12.6 15.8" />
    </Glyph>
  ),

  /** Raw data pooled in a basin — schema decided later, on read. */
  data_lake: ({ size }) => (
    <Glyph size={size}>
      <path d="M2.5 5.5v6.5c0 4.4 4.3 8 9.5 8s9.5-3.6 9.5-8V5.5" />
      <path d="M6 10.5c1.2-1.3 2.4-1.3 3.6 0s2.4 1.3 3.6 0 2.4-1.3 3.6 0" />
      <path d="M6 15c1.2-1.3 2.4-1.3 3.6 0s2.4 1.3 3.6 0 2.4-1.3 3.6 0" />
    </Glyph>
  ),

  /** A tap on the write-ahead log, piping every row change downstream. */
  cdc_connector: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="3.5" width="9" height="17" rx="1.5" />
      <path d="M5 7.5h4M5 11h4M5 14.5h4" />
      <path d="M11.5 11h4.5a2.5 2.5 0 0 1 2.5 2.5V18" />
      <path d="M16.2 16.4 18.5 18.8 20.8 16.4" />
    </Glyph>
  ),

  /** A cylinder with a two-way switch in front — writes left, reads right. */
  db_proxy: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="8" cy="5" rx="5.5" ry="2.2" />
      <path d="M2.5 5v8a5.5 2.2 0 0 0 11 0V5" />
      <path d="M13.5 10.5h6m-2.2-2.2 2.2 2.2-2.2 2.2" />
      <path d="M19.5 16.5h-6m2.2-2.2-2.2 2.2 2.2 2.2" />
    </Glyph>
  ),

  /** Three cylinder slices side by side — one logical store, three partitions. */
  sharded_cluster: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="4.5" cy="7" rx="3" ry="1.5" />
      <path d="M1.5 7v9a3 1.5 0 0 0 6 0V7" />
      <ellipse cx="12" cy="7" rx="3" ry="1.5" />
      <path d="M9 7v9a3 1.5 0 0 0 6 0V7" />
      <ellipse cx="19.5" cy="7" rx="3" ry="1.5" />
      <path d="M16.5 7v9a3 1.5 0 0 0 6 0V7" />
    </Glyph>
  ),

  /** A table with a bolt beside it — the join was paid for in advance. */
  materialized_view: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="4.5" width="12" height="13" rx="1.5" />
      <path d="M2.5 8.5h12M6.5 8.5v9M10.5 4.5v13" />
      <path d="M20.2 7 16 13.4h2.6l-.9 4.2 3.8-6.2h-2.5z" />
    </Glyph>
  ),

  /** A crumb-speckled disc with a clock — state that belongs to one login. */
  session_store: ({ size }) => (
    <Glyph size={size}>
      <circle cx="10" cy="10.5" r="7.5" />
      <path d="M7.5 7.5h.01M12.5 8h.01M9 13h.01M13.5 12.5h.01M11 10.5h.01" />
      <circle cx="18" cy="18" r="4" />
      <path d="M18 15.6V18l1.8 1.1" />
    </Glyph>
  ),

  /** A tape drum with an archive arrow pointing down into the shelf. */
  backup_store: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="9" cy="5.5" rx="6.5" ry="2.5" />
      <path d="M2.5 5.5v10a6.5 2.5 0 0 0 13 0v-10" />
      <path d="M2.5 10.5a6.5 2.5 0 0 0 13 0" />
      <path d="M19 3.5v10m-2.6-2.6L19 13.5l2.6-2.6" />
      <path d="M15.5 17.5h7" />
    </Glyph>
  ),

  /** A bound book with a chain link — entries you append and can never edit. */
  ledger_db: ({ size }) => (
    <Glyph size={size}>
      <path d="M3 4.5a2 2 0 0 1 2-2h9v11H5a2 2 0 0 0-2 2z" />
      <path d="M5 2.5v13" />
      <path d="M7.5 6.5h4M7.5 9.5h4" />
      <rect x="14" y="12" width="6" height="4.2" rx="2.1" />
      <rect x="16.5" y="15.5" width="6" height="4.2" rx="2.1" />
    </Glyph>
  ),

  // ---------- Async ----------

  /** Discrete messages lined up FIFO, one leaving the tail. */
  queue: ({ size }) => (
    <Glyph size={size}>
      <rect x="2" y="8" width="4" height="8" rx="1" />
      <rect x="7" y="8" width="4" height="8" rx="1" />
      <rect x="12" y="8" width="4" height="8" rx="1" />
      <path d="M17.5 12h4m-2.2-2.2L21.5 12l-2.2 2.2" />
    </Glyph>
  ),

  /** An append-only log of records flowing forward. */
  stream: ({ size }) => (
    <Glyph size={size}>
      <path d="M3 6.5h11" />
      <path d="M3 12h13" />
      <path d="M3 17.5h9" />
      <path d="M17.5 12h4m-2.2-2.2L21.5 12l-2.2 2.2" />
    </Glyph>
  ),

  /** One publisher onto a bus bar, three independent subscribers off it. */
  event_bus: ({ size }) => (
    <Glyph size={size}>
      <path d="M1.5 8.5h3.4m-1.6-1.7 1.6 1.7-1.6 1.7" />
      <path d="M5.4 8.5h16.1" />
      <path d="M8.5 8.5v4M14 8.5v4M19.5 8.5v4" />
      <rect x="6" y="12.5" width="5" height="6.5" rx="1.2" />
      <rect x="11.5" y="12.5" width="5" height="6.5" rx="1.2" />
      <rect x="17" y="12.5" width="5" height="6.5" rx="1.2" />
    </Glyph>
  ),

  /** A queue whose exit is a dead end — messages that gave up. */
  dead_letter_queue: ({ size }) => (
    <Glyph size={size}>
      <rect x="2" y="8" width="4.5" height="8" rx="1" />
      <rect x="7.5" y="8" width="4.5" height="8" rx="1" />
      <rect x="13" y="8" width="4.5" height="8" rx="1" />
      <path d="M18.8 9.6 22.4 13.2M22.4 9.6 18.8 13.2" />
    </Glyph>
  ),

  /** A cog turning through a unit of work. */
  worker: ({ size }) => (
    <Glyph size={size}>
      <circle cx="9.5" cy="9.5" r="3" />
      <path d="M9.5 4.5v1.6M9.5 12.9v1.6M4.5 9.5h1.6M12.9 9.5h1.6M6 6l1.1 1.1M11.9 11.9 13 13M13 6l-1.1 1.1M7.1 11.9 6 13" />
      <rect x="13.8" y="13.8" width="7.2" height="7.2" rx="1.5" />
    </Glyph>
  ),

  /** A clock with a sweep arrow — work that fires on a timetable. */
  scheduler: ({ size }) => (
    <Glyph size={size}>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 10v3.5l3 1.8" />
      <path d="M4.6 8.2A8.6 8.6 0 0 1 19.4 8.2" />
      <path d="M16.3 8.7 19.4 8.2 18.8 5.1" />
    </Glyph>
  ),

  /** A flowchart that branches into parallel steps and joins them again. */
  workflow_engine: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 1.8 15.2 5 12 8.2 8.8 5z" />
      <path d="M8.8 5H4.2v5M15.2 5h4.6v5" />
      <rect x="1.8" y="10" width="4.8" height="4.5" rx="1.2" />
      <rect x="17.4" y="10" width="4.8" height="4.5" rx="1.2" />
      <path d="M4.2 14.5v3.5h15.6v-3.5" />
      <path d="M12 18v3.4m-1.7-1.6 1.7 1.6 1.7-1.6" />
    </Glyph>
  ),

  /** Steps that go forward, plus the reverse arrow that undoes them. */
  saga_orchestrator: ({ size }) => (
    <Glyph size={size}>
      <path d="M4.2 12a7.8 7.8 0 0 1 13.3-5.5" />
      <path d="M14.4 5.8 17.6 6.4 17 9.6" />
      <path d="M19.8 12a7.8 7.8 0 0 1-13.3 5.5" />
      <path d="M9.6 18.2 6.4 17.6 7 14.4" />
      <rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1" />
    </Glyph>
  ),

  /** An event leaving its box toward a hook — signed delivery to someone else. */
  webhook_dispatcher: ({ size }) => (
    <Glyph size={size}>
      <rect x="1.8" y="6" width="9" height="12" rx="1.8" />
      <path d="M4.6 10h3.4M4.6 14h3.4" />
      <path d="M10.8 12h4.6m-2.2-2.2 2.2 2.2-2.2 2.2" />
      <path d="M21.6 6v7.4a2.8 2.8 0 0 1-5.6 0V11.8" />
    </Glyph>
  ),

  /** A record plus a delta, streaming out — every change, as it happens. */
  change_feed: ({ size }) => (
    <Glyph size={size}>
      <path d="M2.5 2.5h6.5l3 3v9.5H2.5z" />
      <path d="M9 2.5V5.5h3" />
      <path d="M5 9h4.5M5 12h3" />
      <path d="M17.5 5 21.5 12h-8z" />
      <path d="M12.5 19.5h7m-2.5-2.5 2.5 2.5-2.5 2.5" />
    </Glyph>
  ),

  /** A calendar grid with a play arrow — the nightly window, started on cue. */
  batch_scheduler: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="4.5" width="14" height="15" rx="2" />
      <path d="M2.5 9h14" />
      <path d="M6.5 2.5v4M12.5 2.5v4" />
      <path d="M6 12h2M11 12h2M6 16h2M11 16h2" />
      <path d="M17.5 12.5 22 15.5l-4.5 3z" />
    </Glyph>
  ),

  // ---------- Integration ----------

  /** A card passing between the posts of a gate. */
  payment_gateway: ({ size }) => (
    <Glyph size={size}>
      <path d="M4 3v18M20 3v18" />
      <rect x="6.5" y="8.5" width="11" height="7" rx="1.5" />
      <path d="M6.5 11.5h11" />
      <path d="M9 13.8h2.5" />
    </Glyph>
  ),

  /** An envelope with a send arrow. */
  email_provider: ({ size }) => (
    <Glyph size={size}>
      <rect x="2" y="5.5" width="14" height="11" rx="1.8" />
      <path d="M2 7.5 9 12l7-4.5" />
      <path d="M14 20h7.5m-2.6-2.6 2.6 2.6-2.6 2.6" />
    </Glyph>
  ),

  /** A handset with a message bubble beside it. */
  sms_provider: ({ size }) => (
    <Glyph size={size}>
      <rect x="2" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M4.8 5h4.4M6 19.3h2" />
      <rect x="12.5" y="7" width="9.5" height="8" rx="2" />
      <path d="M15.5 15v3l3.2-3" />
      <path d="M15 10.8h4.5" />
    </Glyph>
  ),

  /** A bell with two arcs radiating off it. */
  push_service: ({ size }) => (
    <Glyph size={size}>
      <path d="M7 15.5V10a4.5 4.5 0 0 1 9 0v5.5h1.5v1.5H5.5v-1.5z" />
      <path d="M9.8 17v.9a1.7 1.7 0 0 0 3.4 0V17" />
      <path d="M18.5 8a6 6 0 0 1 0 8" />
      <path d="M20.5 6a9 9 0 0 1 0 12" />
    </Glyph>
  ),

  /** A badge with a face on it and a tick beside it — someone else vouched. */
  identity_provider: ({ size }) => (
    <Glyph size={size}>
      <rect x="3" y="2.5" width="12" height="17" rx="2" />
      <path d="M5.5 2.5v17" />
      <circle cx="10.2" cy="8.5" r="2.4" />
      <path d="M7.2 15a3 3 0 0 1 6 0" />
      <path d="M15.5 17.5 18 20 22 15.5" />
    </Glyph>
  ),

  // ---------- Media ----------

  /** A sprocketed film frame turning into a smaller one. */
  transcoder: ({ size }) => (
    <Glyph size={size}>
      <rect x="2" y="4.5" width="10" height="13" rx="1.2" />
      <path d="M2 7.5h2M2 11h2M2 14.5h2M10 7.5h2M10 11h2M10 14.5h2" />
      <path d="M13 11h3.2m-1.4-1.4 1.4 1.4-1.4 1.4" />
      <rect x="17" y="8" width="5.5" height="7" rx="1" />
      <path d="M17 9.6h1M17 13.4h1" />
    </Glyph>
  ),

  /** A play triangle broadcasting signal arcs. */
  media_streamer: ({ size }) => (
    <Glyph size={size}>
      <path d="M4 5.5 13 11.5 4 17.5z" />
      <path d="M16 8.5a5 5 0 0 1 0 6" />
      <path d="M18.8 6a8.5 8.5 0 0 1 0 11" />
      <path d="M2 20.5h11" />
    </Glyph>
  ),

  // ---------- AI ----------

  /** A chip with a spark in it. */
  llm: ({ size }) => (
    <Glyph size={size}>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9.5 6V3M14.5 6V3M9.5 21v-3M14.5 21v-3M6 9.5H3M6 14.5H3M21 9.5h-3M21 14.5h-3" />
      <path d="M12 8.4l1.1 2.5 2.5 1.1-2.5 1.1L12 15.6l-1.1-2.5L8.4 12l2.5-1.1z" />
    </Glyph>
  ),

  /** Sentences collapsing into a point in vector space. */
  embedding_svc: ({ size }) => (
    <Glyph size={size}>
      <path d="M2.5 6h5.5M2.5 12h5.5M2.5 18h5.5" />
      <path d="M8.5 6 13.5 11.4M8.5 12h5M8.5 18 13.5 12.6" />
      <circle cx="15.4" cy="12" r="1.9" />
      <path d="M18.8 8.6h.01M21 12h.01M19.3 15.6h.01" />
    </Glyph>
  ),

  /** A cylinder whose contents are directions, not rows. */
  vector_db: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="12" cy="6" rx="7.5" ry="2.75" />
      <path d="M4.5 6v12a7.5 2.75 0 0 0 15 0V6" />
      <path d="M8 16.8 12.6 11.6m-.5 2.4.5-2.4-2.4-.3" />
      <path d="M8 16.8 15.6 15.5m-2 1.2 2-1.2-1.3-1.8" />
    </Glyph>
  ),

  /** A checklist plus a shield with a tick — nothing ships unless it passes. */
  eval_gate: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="3" width="10" height="13" rx="2" />
      <path d="M5.5 7h4M5.5 11h4" />
      <path d="M17 10.5l4.5 1.6v3.4c0 2.5-1.9 4.3-4.5 5-2.6-.7-4.5-2.5-4.5-5v-3.4z" />
      <path d="M15 15.3 16.7 17l3-3.2" />
    </Glyph>
  ),

  /** One request forking toward a small model and a large one. */
  model_router: ({ size }) => (
    <Glyph size={size}>
      <path d="M1.8 12h4.4" />
      <path d="M6.2 12 10 6.3h2.4M6.2 12 10 17.4h2.4" />
      <rect x="12.8" y="3.8" width="5" height="5" rx="1.3" />
      <rect x="12.8" y="13" width="8.4" height="8.4" rx="1.6" />
    </Glyph>
  ),

  /** A bolt inside a prompt bubble — the answer you already paid for. */
  prompt_cache: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.8" y="3.5" width="18.4" height="11" rx="2.5" />
      <path d="M7.5 14.5v4.5l4.5-4.5" />
      <path d="M13.4 4.8 9.4 10.4h2.8l-1 3 3.8-5.7h-2.8z" />
    </Glyph>
  ),

  /** A shield with a funnel in it — the output gets filtered before it ships. */
  guardrail: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 2.2 20.4 5v6.6c0 5.2-3.6 8.8-8.4 10.4C6.8 20.4 3.2 16.8 3.2 11.6V5z" />
      <path d="M7.5 7.8h9l-3.6 4.2v3.8l-1.8 1v-4.8z" />
      <path d="M12 17.8v1.4" />
    </Glyph>
  ),

  /** A candidate list, promoted and demoted into a better order. */
  reranker: ({ size }) => (
    <Glyph size={size}>
      <path d="M2.5 5.5h11M2.5 12h8.5M2.5 18.5h11" />
      <path d="M16.5 20V4.5m-2 2 2-2 2 2" />
      <path d="M20.5 4.5V20m-1.9-1.9L20.5 20l1.9-1.9" />
    </Glyph>
  ),

  /** A loop that keeps calling tools until the task is actually done. */
  agent_runtime: ({ size }) => (
    <Glyph size={size}>
      <path d="M10 3.8a6.2 6.2 0 1 0 4.4 10.6" />
      <path d="M7.6 5.9 10 3.7l2.3 2.3" />
      <circle cx="18.6" cy="15.4" r="2.8" />
      <path d="M16.7 13.5 20.5 17.3" />
      <path d="M13.4 21.6 16.6 18.4" />
    </Glyph>
  ),

  // ---------- Pipeline stages ----------

  /** A stack of documents: the corpus, before anything has been done to it. */
  doc_source: ({ size }) => (
    <Glyph size={size}>
      <path d="M8 3h6l4 4v9a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 16V4.5A1.5 1.5 0 0 1 8 3Z" />
      <path d="M14 3v4h4" />
      <path d="M4 7.5V19a2 2 0 0 0 2 2h9" />
    </Glyph>
  ),

  /** A page with a scan line crossing it: text being lifted off the paper. */
  doc_parser: ({ size }) => (
    <Glyph size={size}>
      <path d="M6 3.5h8l4 4v13H6Z" />
      <path d="M14 3.5v4h4" />
      <path d="M3 12h18" />
      <path d="M9 15.5h6M9 18h4" />
    </Glyph>
  ),

  /** One block cut into three: where the boundaries fall. */
  chunker: ({ size }) => (
    <Glyph size={size}>
      <rect x="3" y="4.5" width="18" height="15" rx="1.6" />
      <path d="M9 4.5v15" strokeDasharray="2.5 2" />
      <path d="M15 4.5v15" strokeDasharray="2.5 2" />
    </Glyph>
  ),

  /** A funnel narrowing prose into fixed fields. */
  extractor: ({ size }) => (
    <Glyph size={size}>
      <path d="M3.5 4.5h17l-6.5 7.5v6l-4 2.5v-8.5Z" />
      <path d="M6.5 8h11" />
    </Glyph>
  ),

  /** A shape with a tick: the output matched the schema. */
  output_validator: ({ size }) => (
    <Glyph size={size}>
      <path d="M5 4.5h9l5 5V17a2.5 2.5 0 0 1-2.5 2.5H5Z" />
      <path d="M14 4.5v5h5" />
      <path d="M7.5 14.2l2.4 2.4 4.6-4.6" />
    </Glyph>
  ),

  /** A magnifier over layered results: search, then rank. */
  retriever: ({ size }) => (
    <Glyph size={size}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M14.6 14.6 20 20" />
      <path d="M7.5 9h6M7.5 12h4" />
    </Glyph>
  ),

  /** A box inside a box: execution with a wall around it. */
  tool_sandbox: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="4" width="19" height="16" rx="2" strokeDasharray="3 2.2" />
      <rect x="7" y="8.5" width="10" height="7" rx="1.2" />
      <path d="M9.5 12h5" />
    </Glyph>
  ),

  /** A socket offering three plugs: tools advertised to a model. */
  mcp_server: ({ size }) => (
    <Glyph size={size}>
      <rect x="4" y="7" width="16" height="10" rx="1.8" />
      <path d="M8 7V4M12 7V4M16 7V4" />
      <path d="M8 17v3M16 17v3" />
    </Glyph>
  ),

  /** A cylinder with a thread through it: state carried across steps. */
  agent_memory: ({ size }) => (
    <Glyph size={size}>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v8c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M8.5 20.5c2-1.6 5.5-1.6 7.5 0" />
    </Glyph>
  ),

  /** A person's outline, because that is what is in the loop. */
  human_review: ({ size }) => (
    <Glyph size={size}>
      <circle cx="12" cy="7.5" r="3.4" />
      <path d="M5.5 20.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
      <path d="M15.8 16.6l1.8 1.8 3-3" />
    </Glyph>
  ),

  /** A rack with a chip in it: inference on hardware you own. */
  model_server: ({ size }) => (
    <Glyph size={size}>
      <rect x="3" y="4" width="18" height="16" rx="1.8" />
      <rect x="8" y="8.5" width="8" height="7" rx="1" />
      <path d="M11 8.5V6.5M13 8.5V6.5M11 17.5v-2M13 17.5v-2" />
      <path d="M6.5 8.5v7M17.5 8.5v7" />
    </Glyph>
  ),

  /** Stacked layers with a version tick: data you can point a result back at. */
  dataset_store: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 3 21 7.5 12 12 3 7.5Z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5 12 21l9-4.5" />
    </Glyph>
  ),

  /** A dial being turned: weights adjusted over a long run. */
  fine_tune_job: ({ size }) => (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 12l4-3" />
      <path d="M12 4v2M20 12h-2M12 20v-2M4 12h2" />
    </Glyph>
  ),

  /** A restarted arrow with a wrench: something being deliberately broken. */
  chaos_injector: ({ size }) => (
    <Glyph size={size}>
      <path d="M20 6.5v4h-4" />
      <path d="M19.4 10.5A8 8 0 1 0 12 20" />
      <path d="M8.5 8.5 15 15" strokeDasharray="2.5 2" />
      <path d="M6.5 6.5 9 9" />
    </Glyph>
  ),

  /** A gauge against a hard stop. */
  budget_guard: ({ size }) => (
    <Glyph size={size}>
      <path d="M4 17a8 8 0 1 1 16 0" />
      <path d="M12 17 16.5 10" />
      <path d="M20 17v3M4 17v3" />
      <path d="M18.5 6.5 20 5" />
    </Glyph>
  ),

  // ---------- Migration & legacy ----------

  /** A cabinet with a dial: the machine that predates all of this. */
  legacy_system: ({ size }) => (
    <Glyph size={size}>
      <rect x="4.5" y="3" width="15" height="18" rx="1.4" />
      <path d="M4.5 9h15M4.5 15h15" />
      <circle cx="9" cy="6" r="1.1" />
      <path d="M13 12h3.5M13 18h3.5" />
    </Glyph>
  ),

  /** One inbound line splitting into two paths, old and new. */
  strangler_facade: ({ size }) => (
    <Glyph size={size}>
      <path d="M2.5 12h5" />
      <path d="M7.5 12c4 0 4-6.5 8-6.5h6" />
      <path d="M7.5 12c4 0 4 6.5 8 6.5h6" strokeDasharray="2.5 2" />
      <circle cx="7.5" cy="12" r="1.6" />
    </Glyph>
  ),

  /** Two stacks with a two-way arrow between them: drift being repaired. */
  reconciler: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="6" width="6" height="12" rx="1.2" />
      <rect x="15.5" y="6" width="6" height="12" rx="1.2" />
      <path d="M9.5 10h5M13 8.5l1.5 1.5L13 11.5" />
      <path d="M14.5 14h-5M11 12.5 9.5 14l1.5 1.5" />
    </Glyph>
  ),

  // ---------- Concepts that had no component ----------

  /** Traffic sorted into separate, sealed compartments. */
  cell_router: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 2.5v4" />
      <rect x="2.5" y="7.5" width="5.5" height="5.5" rx="1" />
      <rect x="9.25" y="7.5" width="5.5" height="5.5" rx="1" />
      <rect x="16" y="7.5" width="5.5" height="5.5" rx="1" />
      <path d="M5.25 13v4M12 13v4M18.75 13v4" />
    </Glyph>
  ),

  /** A key beside a stored result: the same key returns the same answer. */
  idempotency_store: ({ size }) => (
    <Glyph size={size}>
      <circle cx="7" cy="8" r="2.8" />
      <path d="M9.4 9.6 14 14.2M12.4 13 11 14.4M14 14.2l-1.4 1.4" />
      <rect x="13.5" y="4" width="7.5" height="6" rx="1.2" />
      <path d="M15.5 7h3.5" />
    </Glyph>
  ),

  /** A directory card with a heartbeat: who is up, and where. */
  service_registry: ({ size }) => (
    <Glyph size={size}>
      <rect x="3" y="4" width="18" height="16" rx="1.8" />
      <path d="M6.5 8.5h11" />
      <path d="M6.5 15h2l1.5-3 2 5 1.5-2h3.5" />
    </Glyph>
  ),

  /** Two arcs turning into one another: device and server converging. */
  sync_engine: ({ size }) => (
    <Glyph size={size}>
      <path d="M4 10a8 8 0 0 1 13.5-3.4" />
      <path d="M20 14a8 8 0 0 1-13.5 3.4" />
      <path d="M17.5 3.2v3.6h-3.6" />
      <path d="M6.5 20.8v-3.6h3.6" />
    </Glyph>
  ),

  /** A phone holding its own small database. */
  offline_store: ({ size }) => (
    <Glyph size={size}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.2" />
      <ellipse cx="12" cy="10" rx="3.6" ry="1.4" />
      <path d="M8.4 10v4c0 .8 1.6 1.4 3.6 1.4s3.6-.6 3.6-1.4v-4" />
      <path d="M10.6 19.2h2.8" />
    </Glyph>
  ),

  // ---------- Security additions ----------

  /** A shield over a stream of events. */
  siem: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 2.7 19.5 5.5v6c0 4.4-3.2 8-7.5 9.8-4.3-1.8-7.5-5.4-7.5-9.8v-6Z" />
      <path d="M8 11.5h2l1.4-2.6 1.8 4.6 1.2-2h2" />
    </Glyph>
  ),

  /** A signed checkbox: what they agreed to, on the record. */
  consent_store: ({ size }) => (
    <Glyph size={size}>
      <rect x="4" y="3" width="16" height="18" rx="1.6" />
      <path d="M7.5 8.5h4M7.5 12h6" />
      <path d="M7.5 16.5c1.6-1.6 2.6.9 4 0s2.6-1.4 4.5-.6" />
      <path d="M14.5 7.5l1.6 1.6 2.4-2.6" />
    </Glyph>
  ),

  /** A dashed box waiting to be told what it is. */
  custom: ({ size }) => (
    <Glyph size={size}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" strokeDasharray="3 2.4" />
      <path d="M12 9.5v5M9.5 12h5" />
    </Glyph>
  ),

  /** A field with its middle blacked out. */
  pii_redactor: ({ size }) => (
    <Glyph size={size}>
      <rect x="3" y="5" width="18" height="14" rx="1.8" />
      <path d="M6.5 9.5h4" />
      <rect x="12" y="8.4" width="6" height="2.2" rx="0.6" strokeDasharray="0" />
      <path d="M6.5 14.5h5" />
      <rect x="13" y="13.4" width="4.5" height="2.2" rx="0.6" />
    </Glyph>
  ),

  /** Columns of features piped into the model that consumes them. */
  feature_store: ({ size }) => (
    <Glyph size={size}>
      <rect x="1.8" y="4" width="9.6" height="13" rx="1.4" />
      <path d="M1.8 7.6h9.6M5 4v13M8.2 4v13" />
      <path d="M11.4 10.5h3.4m-1.4-1.4 1.6 1.4-1.6 1.4" />
      <rect x="15" y="7" width="7" height="7" rx="1.8" />
      <path d="M18.5 8.8l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" />
    </Glyph>
  ),

  /** A rating star dropped in a tray, filed into a stack of records. */
  feedback_store: ({ size }) => (
    <Glyph size={size}>
      <path d="M7.5 3.2 9 7 13 7.2 9.9 9.8 10.9 13.7 7.5 11.5 4.1 13.7 5.1 9.8 2 7.2 6 7z" />
      <path d="M1.8 15.8h11.4v1.9a1.7 1.7 0 0 1-1.7 1.7H3.5a1.7 1.7 0 0 1-1.7-1.7z" />
      <path d="M14.2 11.5h3.4m-1.5-1.5 1.5 1.5-1.5 1.5" />
      <path d="M18.6 7h3.6M18.6 11.5h3.6M18.6 16h3.6" />
    </Glyph>
  ),

  /** One arrow split into two flasks — the same question asked two ways. */
  experiment_platform: ({ size }) => (
    <Glyph size={size}>
      <path d="M1.8 12h3.6" />
      <path d="M5.4 12 9 7.2h2.2M5.4 12 9 16.8h2.2" />
      <path d="M14 3h3.2v3l3 5.5H11l3-5.5z" />
      <path d="M14 13.5h3.2v3l3 5.5H11l3-5.5z" />
      <path d="M12.8 8.5h5.6M12.1 20h7" />
    </Glyph>
  ),

  // ---------- Security ----------

  /** A person and the key that says what they are allowed to touch. */
  iam: ({ size }) => (
    <Glyph size={size}>
      <circle cx="9" cy="6.5" r="3.2" />
      <path d="M3 20.5a6 6 0 0 1 12 0" />
      <circle cx="17.5" cy="12.5" r="2.2" />
      <path d="M19.1 14.1 22 17" />
      <path d="M20.4 15.4 19.4 16.4M21.4 16.4 20.4 17.4" />
    </Glyph>
  ),

  /** A key locked inside a vault — the key never leaves the box. */
  kms: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
      <path d="M6.5 3.5v17" />
      <circle cx="12.5" cy="9.5" r="2.6" />
      <path d="M14.4 11.4 18.5 15.5" />
      <path d="M16.6 15.5l1.9-1.9M17.6 16.5l1.9-1.9" />
    </Glyph>
  ),

  /** An append-only record with a tick — who did what, provably. */
  audit_log: ({ size }) => (
    <Glyph size={size}>
      <path d="M5.5 2.5h9.5a2 2 0 0 1 2 2v13.5a3 3 0 0 0 3 3H8.5a3 3 0 0 1-3-3z" />
      <path d="M8.5 6.5h6M8.5 10h6" />
      <path d="M8.2 14.2 10.6 16.6 15.4 11.8" />
    </Glyph>
  ),

  // ---------- Ops ----------

  /** A key inside a shield. */
  auth: ({ size }) => (
    <Glyph size={size}>
      <path d="M12 2.5 20 5.2v6.3c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V5.2z" />
      <circle cx="10.2" cy="9.6" r="2.1" />
      <path d="M11.7 11.1 15 14.4" />
      <path d="M13.1 12.5 11.9 13.7M14.4 13.8 13.2 15" />
    </Glyph>
  ),

  /** An eye watching a metric line. */
  observability: ({ size }) => (
    <Glyph size={size}>
      <path d="M2.5 8.5C4.5 5.5 8 3.5 12 3.5s7.5 2 9.5 5c-2 3-5.5 5-9.5 5s-7.5-2-9.5-5z" />
      <circle cx="12" cy="8.5" r="2.2" />
      <path d="M3 20.5l4-4 3.5 2.5L15 14l5.5-3" />
    </Glyph>
  ),

  /** Switches you flip at runtime — one on, one off, no redeploy. */
  feature_flags: ({ size }) => (
    <Glyph size={size}>
      <rect x="3" y="3.5" width="18" height="7" rx="3.5" />
      <circle cx="17.2" cy="7" r="2.1" />
      <rect x="3" y="13.5" width="18" height="7" rx="3.5" />
      <circle cx="6.8" cy="17" r="2.1" />
    </Glyph>
  ),

  /** A padlock over a config document — credentials that never sit in the repo. */
  secrets_manager: ({ size }) => (
    <Glyph size={size}>
      <path d="M6.5 2.5h7l4 4v6.5" />
      <path d="M6.5 2.5a1.8 1.8 0 0 0-1.8 1.8v15.4a1.8 1.8 0 0 0 1.8 1.8h4" />
      <path d="M13.5 2.5v4h4" />
      <rect x="11.5" y="14" width="9.5" height="7" rx="1.6" />
      <path d="M13.8 14v-2a2.5 2.5 0 0 1 5 0v2" />
    </Glyph>
  ),

  /** Stages advancing down a pipeline, driven by automation. */
  ci_cd: ({ size }) => (
    <Glyph size={size}>
      <path d="M1.8 6h6.2m-2.1-2.1L8.2 6 6 8.1" />
      <path d="M10 6h6.2m-2.1-2.1L16.4 6l-2.1 2.1" />
      <path d="M1.8 17h5.4m-2.1-2.1L7.4 17l-2.1 2.1" />
      <circle cx="15.5" cy="16.5" r="3.1" />
      <path d="M15.5 11.7v1.7M15.5 19.6v1.7M10.7 16.5h1.7M18.6 16.5h1.7M12.1 13.1l1.2 1.2M17.7 18.7l1.2 1.2M18.9 13.1l-1.2 1.2M13.3 18.7l-1.2 1.2" />
    </Glyph>
  ),

  // ---------- Layout ----------

  /** A dashed frame with a label tab — a region, VPC or cell. */
  group: ({ size }) => (
    <Glyph size={size}>
      <rect x="2.5" y="4" width="19" height="16" rx="3" strokeDasharray="3.5 2.5" />
      <path d="M6 8.5h5" />
    </Glyph>
  ),
};

export type NodeIcon = (typeof NODE_ICONS)[ArchNodeType];
