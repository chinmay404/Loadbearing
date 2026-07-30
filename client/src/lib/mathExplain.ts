import type { SimFlowResult, SimNodeResult } from '@loadbearing/shared';

/**
 * Shows the working. The simulator's numbers are only convincing — and only
 * teach anything — if you can see the arithmetic that produced them, so every
 * value a component reports is spelled out as the sum it came from.
 */

const n = (x: number, digits = 0): string =>
  Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: digits }) : '∞';

export interface MathLine {
  label: string;
  work: string;
  result: string;
}

export function explainNode(
  sim: SimNodeResult,
  perReplica: number,
  replicas: number,
  baseLatency: number,
): MathLine[] {
  const lines: MathLine[] = [];

  lines.push({
    label: 'capacity',
    work: `${n(perReplica)} rps per replica × ${replicas} ${replicas === 1 ? 'replica' : 'replicas'}`,
    result: `${n(sim.capacityRps)} rps`,
  });

  lines.push({
    label: 'utilization',
    work: `${n(sim.incomingRps)} rps arriving ÷ ${n(sim.capacityRps)} rps of capacity`,
    result: Number.isFinite(sim.utilization) ? `${(sim.utilization * 100).toFixed(0)}%` : 'over capacity',
  });

  if (sim.state === 'down') {
    lines.push({
      label: 'state',
      work: 'taken offline by the current scenario',
      result: 'down',
    });
    return lines;
  }

  // Queueing delay: service time stretches as a node approaches saturation.
  if (sim.utilization < 1) {
    const factor = 1 / Math.max(1 - Math.min(sim.utilization, 0.95), 0.05);
    lines.push({
      label: 'latency',
      work: `${n(baseLatency)}ms service time ÷ (1 − ${sim.utilization.toFixed(2)}) queueing factor ${factor.toFixed(1)}×`,
      result: `${n(sim.latencyMs)}ms`,
    });
  } else {
    lines.push({
      label: 'latency',
      work: `saturated, so service time is pinned at the 20× ceiling of ${n(baseLatency)}ms`,
      result: `${n(sim.latencyMs)}ms`,
    });
  }

  if (sim.droppedRps > 0) {
    lines.push({
      label: 'shed',
      work: `${n(sim.incomingRps)} rps arriving − ${n(sim.capacityRps)} rps it can serve`,
      result: `${n(sim.droppedRps)} rps dropped`,
    });
  }

  if (sim.queueDepth > 0) {
    lines.push({
      label: 'backlog',
      work: 'arrivals minus what the consumers drain, accumulated over one minute',
      result: `${n(sim.queueDepth)} messages`,
    });
  }

  return lines;
}

export function explainFlow(flow: SimFlowResult, stepLatencies: number[]): MathLine[] {
  const lines: MathLine[] = [];
  lines.push({
    label: 'p50',
    work: stepLatencies.length
      ? `${stepLatencies.map((l) => `${n(l)}`).join(' + ')} ms across ${stepLatencies.length} hops`
      : 'sum of the service time at every hop',
    result: `${n(flow.p50Ms)}ms`,
  });
  lines.push({
    label: 'p99',
    work: 'p50 × 2.5, plus one extra service time for every hop already above 70% utilization',
    result: `${n(flow.p99Ms)}ms`,
  });
  lines.push({
    label: 'completed',
    work: `${n(flow.offeredRps)} rps offered, surviving each hop's capacity in turn`,
    result: `${n(flow.completedRps)} rps (${flow.offeredRps > 0 ? ((flow.completedRps / flow.offeredRps) * 100).toFixed(0) : '0'}%)`,
  });
  return lines;
}
