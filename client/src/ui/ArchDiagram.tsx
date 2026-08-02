import { useId, useMemo, useState } from 'react';
import { layoutDiagram, type DiagramLink, type ProblemDiagram } from '@loadbearing/shared';
import { NODE_ICONS } from '../canvas/icons';
import { NODE_SPEC } from '../canvas/nodeCatalog';

/**
 * A drawn architecture, read-only.
 *
 * The brief describes a system in prose — "a five-table join on a single Postgres
 * instance pinned at 85% CPU" — and prose is a poor way to hold six boxes and their
 * connections in your head before you have drawn anything. This renders the same
 * authored graph the canvas would place, at a size that fits in a side panel.
 *
 * SVG rather than React Flow on purpose: nothing here is interactive except hovering
 * a box for its note, and mounting a second canvas inside a panel to display eight
 * static boxes would be absurd.
 */
export function ArchDiagram({
  diagram,
  height = 260,
}: {
  diagram: ProblemDiagram;
  /** Cap in CSS pixels — wide diagrams scale down rather than overflowing the panel. */
  height?: number;
}) {
  const layout = useMemo(() => layoutDiagram(diagram), [diagram]);
  const [hovered, setHovered] = useState<string | null>(null);
  // Marker ids are document-global, so two diagrams on one page would share arrowheads
  // and the second would inherit the first's colours.
  const uid = useId().replace(/:/g, '');

  if (layout.boxes.length === 0) return null;

  const note = hovered ? layout.boxes.find((b) => b.key === hovered)?.annotation : '';

  return (
    <figure className="arch-diagram">
      <svg
        viewBox={layout.viewBox}
        style={{ maxHeight: height }}
        role="img"
        aria-label={diagram.caption}
      >
        <defs>
          {(['sync', 'async', 'replication'] as const).map((kind) => (
            <marker
              key={kind}
              id={`${uid}-${kind}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 8 4 L 0 8 z" fill={STROKE[kind]} />
            </marker>
          ))}
        </defs>

        {layout.links.map((link, i) => (
          <Link key={i} link={link} markerPrefix={uid} />
        ))}

        {layout.boxes.map((box) => {
          const spec = NODE_SPEC[box.type];
          const Icon = NODE_ICONS[box.type];
          if (box.group) {
            return (
              <g key={box.key}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  rx={8}
                  className="dg-group"
                />
                <text x={box.x + 10} y={box.y + 16} className="dg-group-label">
                  {box.label}
                </text>
              </g>
            );
          }
          return (
            <g
              key={box.key}
              onPointerEnter={() => setHovered(box.key)}
              onPointerLeave={() => setHovered((h) => (h === box.key ? null : h))}
              className={`dg-node${hovered === box.key ? ' hot' : ''}`}
            >
              <title>{box.annotation || spec.hint}</title>
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={5} className="dg-box" />
              {/* The accent bar is what the real node wears, and it is how you
                  recognise a cache from a queue at this size. */}
              <rect x={box.x} y={box.y} width={box.w} height={2.5} fill={spec.color} rx={1} />
              <g transform={`translate(${box.x + 9}, ${box.y + box.h / 2 - 7})`} color={spec.color}>
                <Icon size={14} />
              </g>
              <text x={box.x + 29} y={box.y + box.h / 2 + 4} className="dg-label">
                {clip(box.label, 17)}
              </text>
            </g>
          );
        })}

        {layout.links.map((link, i) =>
          link.label ? (
            <text key={`l${i}`} x={link.mid.x} y={link.mid.y - 4} className="dg-edge-label">
              {clip(link.label, 22)}
            </text>
          ) : null,
        )}
      </svg>

      <figcaption>
        {/* Hovering swaps the caption for that component's note. One line either way,
            so the panel does not jump as the pointer moves across the picture. */}
        {note || diagram.caption}
      </figcaption>
    </figure>
  );
}

const STROKE: Record<DiagramLink['kind'], string> = {
  sync: '#8a8578',
  async: '#7c9a86',
  replication: '#8b7ca0',
};

function Link({ link, markerPrefix }: { link: DiagramLink; markerPrefix: string }) {
  return (
    <path
      d={link.path}
      fill="none"
      stroke={STROKE[link.kind]}
      strokeWidth={1.2}
      // Async is dashed and replication is dotted, matching the canvas — a diagram
      // that used different conventions than the sheet would teach the wrong thing.
      strokeDasharray={link.kind === 'async' ? '4 3' : link.kind === 'replication' ? '1.5 3' : undefined}
      markerEnd={`url(#${markerPrefix}-${link.kind})`}
      opacity={0.85}
    />
  );
}

/** Truncate to fit the box; the full text is in the hover note. */
const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
