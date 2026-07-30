// Hand-drawn line-art icons for every architecture node type.
// Feather/Lucide house style: 24x24 grid, 1.6 stroke, currentColor, no fills,
// no text glyphs, no randomness. Each icon must stay legible at 18px.
import type { JSX, ReactNode } from 'react';
import type { ArchNodeType } from '@archdojo/shared';

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

  /** Box with an arrow leaving it — something you call but do not own. */
  third_party: ({ size }) => (
    <Glyph size={size}>
      <path d="M20 12.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6.5" />
      <path d="M15 3.5h5.5V9" />
      <path d="M20.5 3.5 12.5 11.5" />
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
