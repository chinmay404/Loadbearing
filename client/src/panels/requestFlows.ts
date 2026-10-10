import { sameFlowName, type Flow, type FlowPlan } from '@loadbearing/shared';

/**
 * Which declared flow each request card owns, and which flows are left over.
 *
 * Every flow lands in exactly one place. A second flow with a plan's name used to
 * appear nowhere — not on the card, which showed the first, and not in the list —
 * while still sending traffic in the load run, with no way to delete it.
 */
export function assignFlows(plans: FlowPlan[], flows: Flow[]): { byPlan: Map<string, Flow>; extra: Flow[] } {
  const byPlan = new Map<string, Flow>();
  const taken = new Set<string>();
  for (const plan of plans) {
    const flow = flows.find((f) => !taken.has(f.id) && sameFlowName(f.name, plan.name));
    if (!flow) continue;
    byPlan.set(plan.name, flow);
    taken.add(flow.id);
  }
  return { byPlan, extra: flows.filter((f) => !taken.has(f.id)) };
}
