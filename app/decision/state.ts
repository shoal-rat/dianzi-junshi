import { BELIEF_DIMENSIONS, type BeliefDimension, type BeliefState, type ChangeSignal,
  type PatternSignal, type StateHypothesis, type StructuredObservation } from "./types";
import type { DecisionEvent } from "./types";

function clamp(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function weightedStats(rows: StructuredObservation[], halfLifeDays: number): { mean: number; variance: number; mass: number; ids: string[] } {
  let mass = 0;
  let sum = 0;
  const now = Date.now();
  const weighted = rows.map((row) => {
    const ageDays = Math.max(0, (now - Date.parse(row.observedAt)) / 86_400_000);
    const weight = row.confidence * row.reliability * Math.pow(.5, ageDays / halfLifeDays);
    mass += weight;
    sum += row.value * weight;
    return { row, weight };
  });
  const mean = mass ? sum / mass : 0;
  const variance = mass ? weighted.reduce((acc, item) => acc + item.weight * (item.row.value - mean) ** 2, 0) / mass : 1;
  return { mean, variance, mass, ids: weighted.filter((x) => x.weight >= .08).slice(0, 12).map((x) => x.row.id) };
}

export function buildBeliefs(observations: StructuredObservation[]): BeliefState[] {
  return BELIEF_DIMENSIONS.map((dimension) => {
    const rows = observations.filter((item) => item.dimension === dimension);
    const short = weightedStats(rows, 21);
    const long = weightedStats(rows, 240);
    const confidence = 1 - Math.exp(-long.mass / 3.2);
    const shortConfidence = 1 - Math.exp(-short.mass / 1.8);
    const gap = Math.abs(short.mean - long.mean);
    const changing = rows.length >= 3 && shortConfidence >= .38 && gap >= .24;
    const mean = clamp((changing ? .72 : .38) * short.mean + (changing ? .28 : .62) * long.mean);
    const positive = rows.filter((x) => x.value > .25).length;
    const negative = rows.filter((x) => x.value < -.25).length;
    const conflicted = Math.min(positive, negative) >= 2 && long.variance >= .18;
    const last = rows.reduce((latest, x) => Math.max(latest, Date.parse(x.observedAt)), 0);
    return {
      dimension, mean, variance: Math.min(1, long.variance), confidence,
      shortTerm: short.mean, longTerm: long.mean, effectiveSampleSize: long.mass,
      evidenceCount: rows.length, changing, conflicted,
      stale: Boolean(last && Date.now() - last > 120 * 86_400_000), evidenceIds: long.ids,
    };
  });
}

function belief(states: BeliefState[], key: BeliefDimension): BeliefState {
  return states.find((item) => item.dimension === key)!;
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exp = values.map((value) => Math.exp(value - max));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map((value) => value / total);
}

/** Linear scoring weights of each regime over the belief dimensions. Exported
 * so the decision-network trace can draw the exact belief→regime edges. */
export const REGIME_SCORING: Record<string, Partial<Record<BeliefDimension, number>>> = {
  receptive: { engagement: 1.2, momentum: .8, trust: .4 },
  uncertain: { consistency: -.4, engagement: .25 },
  pressured: { emotional_pressure: 1.25, boundary_sensitivity: .65, engagement: -.35 },
  disengaging: { engagement: -1.05, momentum: -.8, trust: -.35 },
};

export function buildHypotheses(states: BeliefState[]): StateHypothesis[] {
  const engagement = belief(states, "engagement");
  const trust = belief(states, "trust");
  const pressure = belief(states, "emotional_pressure");
  const boundary = belief(states, "boundary_sensitivity");
  const momentum = belief(states, "momentum");
  const consistency = belief(states, "consistency");
  const w = REGIME_SCORING;
  const raw = [
    { id: "receptive", label: "愿意继续互动",
      score: w.receptive.engagement! * engagement.mean + w.receptive.momentum! * momentum.mean + w.receptive.trust! * trust.mean,
      explanation: "投入度和推进势头支持继续互动", support: [...engagement.evidenceIds, ...momentum.evidenceIds], against: pressure.evidenceIds },
    { id: "uncertain", label: "有兴趣但仍在观望",
      score: .7 - Math.abs(momentum.mean) + w.uncertain.consistency! * consistency.mean + w.uncertain.engagement! * engagement.mean,
      explanation: "线索还没有收敛，可能仍在观察", support: [...consistency.evidenceIds], against: momentum.evidenceIds },
    { id: "pressured", label: "当前压力较高，先降负担",
      score: w.pressured.emotional_pressure! * pressure.mean + w.pressured.boundary_sensitivity! * boundary.mean + w.pressured.engagement! * engagement.mean,
      explanation: "情绪压力和戒备线索目前占主导", support: [...pressure.evidenceIds, ...boundary.evidenceIds], against: engagement.evidenceIds },
    { id: "disengaging", label: "互动意愿正在降低",
      score: w.disengaging.engagement! * engagement.mean + w.disengaging.momentum! * momentum.mean + w.disengaging.trust! * trust.mean,
      explanation: "投入与势头偏弱，推进可能带来反效果", support: [...engagement.evidenceIds, ...momentum.evidenceIds], against: trust.evidenceIds },
  ];
  const probabilities = softmax(raw.map((item) => item.score * 1.4));
  return raw.map((item, index) => ({
    id: item.id, label: item.label, probability: probabilities[index], explanation: item.explanation,
    supportingEvidenceIds: [...new Set(item.support)].slice(0, 8),
    contradictingEvidenceIds: [...new Set(item.against)].slice(0, 5),
  })).sort((a, b) => b.probability - a.probability);
}

export function detectChanges(states: BeliefState[]): ChangeSignal[] {
  return states.filter((state) => state.changing).map((state) => ({
    dimension: state.dimension,
    magnitude: Math.abs(state.shortTerm - state.longTerm),
    confidence: Math.min(state.confidence, 1 - Math.exp(-state.effectiveSampleSize / 2)),
    direction: state.shortTerm >= state.longTerm ? "up" as const : "down" as const,
    explanation: `近期值 ${state.shortTerm.toFixed(2)} 与长期值 ${state.longTerm.toFixed(2)} 出现可重复差异`,
  })).sort((a, b) => b.confidence * b.magnitude - a.confidence * a.magnitude);
}

export function discoverPatterns(events: DecisionEvent[]): PatternSignal[] {
  const outcomes = events.filter((event) => event.type === "outcome.recorded");
  const candidates: PatternSignal[] = [];
  const delayed = outcomes.filter((event) => Number(event.payload.responseDelayHours ?? 0) >= 24);
  if (outcomes.length) candidates.push(pattern(
    "slow-response", "回复经常超过一天", delayed.length, outcomes.length - delayed.length,
    "统计已记录的回复时延，用来校准节奏预期。",
  ));
  const positive = outcomes.filter((event) => event.payload.outcome === "positive");
  if (outcomes.length) candidates.push(pattern(
    "positive-outcome", "近期建议后续整体顺利", positive.length, outcomes.length - positive.length,
    "由真实后续反馈验证，会随新结果和时间衰减。",
  ));
  const noReply = outcomes.filter((event) => event.payload.outcome === "no_reply");
  if (outcomes.length) candidates.push(pattern(
    "no-reply", "建议后出现未回复的情况", noReply.length, outcomes.length - noReply.length,
    "用来调整推进节奏和策略选择。",
  ));
  return candidates.filter((item) => item.support > 0).sort((a, b) => b.confidence - a.confidence);
}

function pattern(id: string, label: string, support: number, counterexamples: number, explanation: string): PatternSignal {
  const total = support + counterexamples;
  const confidence = total < 3 ? total / 10 : (support + 1) / (total + 2) * (1 - Math.exp(-total / 4));
  return { id, label, support, counterexamples, confidence, validated: support >= 3 && confidence >= .42, explanation };
}

export function missingInformation(states: BeliefState[], hypotheses: StateHypothesis[]): string[] {
  const missing: string[] = [];
  const low = states.filter((item) => item.confidence < .28).map((item) => item.dimension);
  if (low.includes("engagement")) missing.push("对方最近是否会主动延续话题");
  if (low.includes("commitment_reliability")) missing.push("约定之后是否真的有行动");
  if (low.includes("boundary_sensitivity")) missing.push("对方现在更想被陪伴，还是更需要空间");
  if ((hypotheses[0]?.probability ?? 0) - (hypotheses[1]?.probability ?? 0) < .12) missing.push("当前最强的两种解释仍难区分");
  return [...new Set(missing)].slice(0, 4);
}
