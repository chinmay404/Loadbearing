import type { CanvasDoc, GraphDSL } from '@loadbearing/shared';

const clean = (s: string) => s.replace(/["\n]/g, ' ').trim();

/** Mermaid, for pasting into a PR, a README or an Obsidian note. */
export function toMermaid(graph: GraphDSL): string {
  const lines = ['graph LR'];
  const groups = graph.nodes.filter((n) => n.type === 'group');
  const inGroup = new Set<string>();

  for (const g of groups) {
    const members = graph.nodes.filter((n) => n.parentId === g.id);
    if (members.length === 0) continue;
    lines.push(`  subgraph ${g.id}["${clean(g.label)}"]`);
    for (const m of members) {
      inGroup.add(m.id);
      lines.push(`    ${m.id}["${clean(m.label)}"]`);
    }
    lines.push('  end');
  }

  for (const n of graph.nodes) {
    if (n.type === 'group' || inGroup.has(n.id)) continue;
    lines.push(`  ${n.id}["${clean(n.label)}"]`);
  }

  for (const e of graph.edges) {
    const arrow = e.kind === 'sync' ? '-->' : e.kind === 'async' ? '-.->' : '==>';
    lines.push(`  ${e.from} ${arrow}${e.label ? `|${clean(e.label)}|` : ''} ${e.to}`);
  }

  for (const f of graph.flows) {
    if (f.steps.length > 1) lines.push(`  %% flow "${clean(f.name)}": ${f.steps.join(' -> ')} @ ${f.rps} rps`);
  }
  return lines.join('\n');
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * draw.io / diagrams.net XML, so the drawing can be hand-arranged and shared with
 * people who do not have Loadbearing. Positions are kept, which is the whole point.
 */
export function toDrawio(doc: CanvasDoc): string {
  const cells: string[] = [];
  for (const n of doc.nodes) {
    const w = n.size?.w ?? 160;
    const h = n.size?.h ?? 60;
    const label = esc(`${n.label}\n[${n.type}]${n.annotation ? `\n${n.annotation}` : ''}`);
    const style =
      n.type === 'group'
        ? 'rounded=0;dashed=1;fillColor=none;strokeColor=#A09A90;verticalAlign=top;'
        : 'rounded=1;whiteSpace=wrap;html=1;fillColor=#1a1917;strokeColor=#CFA349;fontColor=#EDE9E1;align=left;spacingLeft=6;';
    cells.push(
      `        <mxCell id="${esc(n.id)}" value="${label}" style="${style}" vertex="1" parent="1">\n` +
        `          <mxGeometry x="${Math.round(n.position.x)}" y="${Math.round(n.position.y)}" width="${w}" height="${h}" as="geometry" />\n` +
        `        </mxCell>`,
    );
  }
  for (const s of doc.stickies) {
    cells.push(
      `        <mxCell id="${esc(s.id)}" value="${esc(s.text)}" style="shape=note;whiteSpace=wrap;html=1;fillColor=#2A2410;strokeColor=#55491C;fontColor=#F0DFA8;align=left;" vertex="1" parent="1">\n` +
        `          <mxGeometry x="${Math.round(s.position.x)}" y="${Math.round(s.position.y)}" width="180" height="90" as="geometry" />\n` +
        `        </mxCell>`,
    );
  }
  for (const e of doc.edges) {
    const style =
      e.kind === 'sync'
        ? 'edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#A09A90;'
        : e.kind === 'async'
          ? 'edgeStyle=orthogonalEdgeStyle;rounded=1;dashed=1;strokeColor=#7BA75F;'
          : 'edgeStyle=orthogonalEdgeStyle;rounded=1;dashed=1;dashPattern=1 3;strokeColor=#B07CA8;';
    cells.push(
      `        <mxCell id="${esc(e.id)}" value="${esc(e.label)}" style="${style}" edge="1" parent="1" source="${esc(e.from)}" target="${esc(e.to)}">\n` +
        `          <mxGeometry relative="1" as="geometry" />\n` +
        `        </mxCell>`,
    );
  }

  return `<mxfile host="Loadbearing">
  <diagram name="Architecture">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" page="1" background="#121110">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
