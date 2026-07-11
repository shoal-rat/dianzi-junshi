import type {
  BeliefState, CriticScore, EvidenceRef, PlanningMode, SimulationBranch, StateHypothesis,
  StrategyCandidate, StrategyFamily, UncertaintyReport, PatternSignal,
} from "./types";
import { posteriorFor } from "./store";

const STRATEGY_LIBRARY: Record<StrategyFamily, Omit<StrategyCandidate, "id" | "prior" | "explorationBonus" | "score">> = {
  mirror: { family: "mirror", label: "顺着对方的节奏", intent: "维持同频，不额外施压", tactic: "复用对方的语气和信息量", tone: "自然、短", risk: "可能推进较慢", informationGain: .28 },
  warm: { family: "warm", label: "先接住感受", intent: "降低压力并表达在场", tactic: "确认感受，不急着解决问题", tone: "温和、克制", risk: "过度安慰会显得用力", informationGain: .22 },
  playful: { family: "playful", label: "轻松接梗", intent: "用低负担互动恢复节奏", tactic: "轻微自嘲或镜像玩笑", tone: "松弛、有分寸", risk: "严肃情境下可能显得不尊重", informationGain: .32 },
  direct: { family: "direct", label: "把意思说清楚", intent: "减少猜测和歧义", tactic: "简短表达立场或需求", tone: "坦率、不逼迫", risk: "对方压力高时可能太重", informationGain: .55 },
  invite: { family: "invite", label: "给一个轻量邀约", intent: "用行动验证互动意愿", tactic: "具体但容易拒绝的小邀约", tone: "轻松、留退路", risk: "势头不足时会暴露推进压力", informationGain: .72 },
  clarify: { family: "clarify", label: "问一个容易回答的问题", intent: "补足关键背景", tactic: "一次只问一个事实问题", tone: "好奇、不审问", risk: "问题太多会造成负担", informationGain: .76 },
  give_space: { family: "give_space", label: "留一点空间", intent: "避免在高压或低投入时继续加码", tactic: "短句收住并给出可回来的入口", tone: "平静、体面", risk: "可能暂时中断互动", informationGain: .16 },
  boundary: { family: "boundary", label: "温和说明边界", intent: "保护双方感受和可持续互动", tactic: "描述事实、感受和下一步", tone: "清楚、不指责", risk: "需要避免像最后通牒", informationGain: .48 },
  seek_more_context: { family: "seek_more_context", label: "先补一条关键信息", intent: "信息不足时避免凭空判断", tactic: "向用户确认最能区分两种解释的事实", tone: "诚实、具体", risk: "不能立刻给出完整结论", informationGain: .92 },
};

export interface RewardWeights {
  goalAlignment: number; evidenceUse: number; consistency: number; naturalness: number;
  informationValue: number; learnedPrior: number; riskPenalty: number;
}

export const DEFAULT_REWARD_WEIGHTS: RewardWeights = {
  goalAlignment: .29, evidenceUse: .14, consistency: .13, naturalness: .15,
  informationValue: .12, learnedPrior: .1, riskPenalty: .22,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function state(states: BeliefState[], key: BeliefState["dimension"]): BeliefState {
  return states.find((item) => item.dimension === key)!;
}

export function generateStrategies(
  profileSlug: string,
  mode: string,
  planningMode: PlanningMode,
  states: BeliefState[],
  hypotheses: StateHypothesis[],
  missing: string[],
  patterns: PatternSignal[] = [],
  lookupPosterior: typeof posteriorFor = posteriorFor,
): StrategyCandidate[] {
  const pressure = state(states, "emotional_pressure").mean;
  const boundary = state(states, "boundary_sensitivity").mean;
  const momentum = state(states, "momentum").mean;
  const engagement = state(states, "engagement").mean;
  const dominant = hypotheses[0]?.id ?? "unknown";
  const families = new Set<StrategyFamily>(["mirror", "clarify", "give_space"]);
  if (pressure > .15) families.add("warm");
  else families.add("playful");
  if (momentum > .15 && engagement > -.1) families.add("invite");
  if (mode === "ask" || mode === "interest") families.add("direct");
  if (boundary > .2 || mode === "ask") families.add("boundary");
  if (valueOfInformation(hypotheses, missing.length, planningMode) >= .42) families.add("seek_more_context");

  const context = `${planningMode}:${dominant}`;
  return [...families].map((family) => {
    const base = STRATEGY_LIBRARY[family];
    const posterior = lookupPosterior(profileSlug, context, family);
    const explorationBonus = Math.min(.18, .16 / Math.sqrt(posterior.samples + 1));
    const situational = family === "warm" ? .14 * pressure
      : family === "give_space" ? .12 * pressure + .1 * boundary - .08 * momentum
      : family === "invite" ? .14 * momentum + .1 * engagement - .16 * pressure
      : family === "playful" ? .08 * engagement - .13 * pressure
      : family === "boundary" ? .12 * boundary
      : family === "seek_more_context" ? missing.length * .035
      : 0;
    const patternAdjustment = patterns.filter((item) => item.lifecycle === "active").reduce((sum, pattern) => {
      if (pattern.id === "slow-response" && ["give_space", "mirror"].includes(family)) return sum + .06 * pattern.confidence;
      if (pattern.id === "no-reply" && ["give_space", "boundary", "clarify"].includes(family)) return sum + .08 * pattern.confidence;
      if (pattern.id === "no-reply" && family === "invite") return sum - .1 * pattern.confidence;
      if (pattern.id === "positive-outcome" && ["mirror", "playful", "invite"].includes(family)) return sum + .05 * pattern.confidence;
      return sum;
    }, 0);
    return {
      ...base, id: crypto.randomUUID(), prior: posterior.mean, explorationBonus,
      score: clamp(.46 * posterior.mean + .34 * .5 + situational + patternAdjustment + explorationBonus),
    };
  }).slice(0, planningMode === "fast" ? 4 : planningMode === "balanced" ? 6 : 8);
}

/** Expected decision improvement from one clarifying question, minus user
 * effort and latency. It intentionally stays conservative in fast mode. */
export function valueOfInformation(hypotheses: StateHypothesis[], missingCount: number, mode: PlanningMode): number {
  const uncertainty = 1 - (hypotheses[0]?.probability ?? .25);
  const distinguishability = Math.min(1, missingCount / 3);
  const informationBenefit = uncertainty * distinguishability;
  const interactionCost = mode === "fast" ? .26 : mode === "deep" ? .1 : .16;
  return clamp(informationBenefit - interactionCost);
}

export function simulateStrategies(
  strategies: StrategyCandidate[],
  hypotheses: StateHypothesis[],
  states: BeliefState[],
  planningMode: PlanningMode,
): SimulationBranch[] {
  const branchLimit = planningMode === "fast" ? 2 : planningMode === "balanced" ? 3 : 4;
  const pressure = state(states, "emotional_pressure").mean;
  const boundary = state(states, "boundary_sensitivity").mean;
  const momentum = state(states, "momentum").mean;
  const branches: SimulationBranch[] = [];
  for (const strategy of strategies) {
    for (const hypothesis of hypotheses.slice(0, branchLimit)) {
      const fit = strategyFit(strategy.family, hypothesis.id, pressure, boundary, momentum);
      const immediateReward = clamp(.5 + fit * .38 + (strategy.prior - .5) * .28);
      const risk = clamp(.18 - fit * .18 + (strategy.family === "invite" ? Math.max(0, pressure) * .35 : 0));
      branches.push({
        id: crypto.randomUUID(), strategyId: strategy.id,
        outcome: branchDescription(strategy.family, hypothesis.id, fit),
        probability: hypothesis.probability, immediateReward,
        delayedReward: clamp(immediateReward * .82 + strategy.informationGain * .18),
        risk, hypothesisId: hypothesis.id,
      });
    }
  }
  return branches;
}

function strategyFit(family: StrategyFamily, hypothesis: string, pressure: number, boundary: number, momentum: number): number {
  let fit = 0;
  if (hypothesis === "pressured") fit += ["warm", "give_space", "clarify"].includes(family) ? .65 : -.42;
  if (hypothesis === "receptive") fit += ["mirror", "playful", "invite", "direct"].includes(family) ? .5 : .05;
  if (hypothesis === "uncertain") fit += ["mirror", "clarify", "direct"].includes(family) ? .42 : -.05;
  if (hypothesis === "disengaging") fit += ["give_space", "boundary", "seek_more_context"].includes(family) ? .55 : -.36;
  if (family === "invite") fit += momentum * .45 - pressure * .45;
  if (family === "warm") fit += pressure * .32;
  if (family === "boundary") fit += boundary * .3;
  return Math.max(-1, Math.min(1, fit));
}

function branchDescription(family: StrategyFamily, hypothesis: string, fit: number): string {
  if (fit > .42) return `${hypothesis} 成立时，${STRATEGY_LIBRARY[family].label}较可能降低摩擦并得到可观察反馈`;
  if (fit < -.3) return `${hypothesis} 成立时，这个策略可能增加压力或造成误读`;
  return `${hypothesis} 成立时，结果可能中性，需要看对方是否继续互动`;
}

export function evaluateStrategies(
  strategies: StrategyCandidate[],
  simulations: SimulationBranch[],
  evidence: EvidenceRef[],
  antiSimp: boolean,
  weights: RewardWeights = DEFAULT_REWARD_WEIGHTS,
): CriticScore[] {
  return strategies.map((strategy) => {
    const branches = simulations.filter((item) => item.strategyId === strategy.id);
    const expected = branches.reduce((sum, branch) => sum + branch.probability * branch.delayedReward, 0);
    const risk = branches.reduce((sum, branch) => sum + branch.probability * branch.risk, 0);
    const evidenceUse = clamp(.24 + evidence.length / 18);
    const naturalness = ["mirror", "playful", "give_space"].includes(strategy.family) ? .86
      : strategy.family === "seek_more_context" ? .72 : .78;
    const consistency = clamp(.55 + (strategy.prior - .5) * .45);
    const goalAlignment = clamp(expected + (antiSimp && ["boundary", "give_space"].includes(strategy.family) ? .08 : 0));
    const critic: CriticScore = {
      strategyId: strategy.id, goalAlignment, evidenceUse, consistency, naturalness,
      informationValue: strategy.informationGain, risk,
      notes: risk > .5 ? ["情境分支中的压力风险较高"] : evidence.length < 3 ? ["可用证据较少"] : [],
    };
    strategy.score = clamp(
      weights.goalAlignment * goalAlignment + weights.evidenceUse * evidenceUse
      + weights.consistency * consistency + weights.naturalness * naturalness
      + weights.informationValue * strategy.informationGain + weights.learnedPrior * strategy.prior
      + strategy.explorationBonus - weights.riskPenalty * risk,
    );
    return critic;
  });
}

function entropy(hypotheses: StateHypothesis[]): number {
  const n = Math.max(2, hypotheses.length);
  return -hypotheses.reduce((sum, item) => sum + (item.probability ? item.probability * Math.log(item.probability) : 0), 0) / Math.log(n);
}

export function assessUncertainty(
  states: BeliefState[],
  hypotheses: StateHypothesis[],
  strategies: StrategyCandidate[],
  simulations: SimulationBranch[],
  evidence: EvidenceRef[],
): UncertaintyReport {
  const sorted = [...strategies].sort((a, b) => b.score - a.score);
  const scoreMargin = clamp((sorted[0]?.score ?? 0) - (sorted[1]?.score ?? 0));
  const conflict = states.filter((item) => item.conflicted).length / Math.max(1, states.length);
  const topBranches = simulations.filter((item) => item.strategyId === sorted[0]?.id);
  const mean = topBranches.reduce((s, b) => s + b.probability * b.delayedReward, 0);
  const variance = topBranches.reduce((s, b) => s + b.probability * (b.delayedReward - mean) ** 2, 0);
  const coverage = clamp(evidence.reduce((s, item) => s + item.reliability * (item.relevance ?? .4), 0) / 4.5);
  const stateEntropy = entropy(hypotheses);
  const total = clamp(.31 * stateEntropy + .2 * conflict + .19 * Math.min(1, variance * 5)
    + .18 * (1 - coverage) + .12 * (1 - Math.min(1, scoreMargin * 6)));
  const abstain = evidence.length < 2 || (total > .76 && coverage < .42);
  return {
    total, stateEntropy, evidenceConflict: conflict, simulationVariance: variance,
    scoreMargin, evidenceCoverage: coverage, abstain,
    reason: abstain ? (evidence.length < 2 ? "可核对的信息太少" : "几种解释接近且证据覆盖不足") : undefined,
  };
}

export function selectStrategy(
  strategies: StrategyCandidate[],
  uncertainty: UncertaintyReport,
): { selected: StrategyCandidate; reason: string } {
  const ranked = [...strategies].sort((a, b) => b.score - a.score);
  if (uncertainty.abstain) {
    const safe = ranked.find((item) => item.family === "seek_more_context")
      ?? ranked.find((item) => item.family === "clarify")
      ?? ranked.find((item) => item.family === "give_space")!;
    return { selected: safe, reason: `不确定性较高（${Math.round(uncertainty.total * 100)}%），先选择可逆、能补信息的方案` };
  }
  const selected = ranked[0];
  return { selected, reason: `综合情境适配、证据、长期收益、信息价值和风险后得分最高（${selected.score.toFixed(2)}）` };
}

export function strategyAlternatives(strategies: StrategyCandidate[], selectedId: string): StrategyCandidate[] {
  return strategies.filter((item) => item.id !== selectedId).sort((a, b) => b.score - a.score).slice(0, 2);
}
