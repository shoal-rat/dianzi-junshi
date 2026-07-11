import type {
  BeliefState, CriticScore, EvidenceRef, PlanningMode, SimulationBranch, StateHypothesis,
  StrategyCandidate, StrategyFamily, UncertaintyReport, PatternSignal, WorldModelSnapshot,
} from "./types";
import { posteriorFor } from "./store";
import { expectedValueOfInformation, rolloutStrategies } from "./worldmodel";

const STRATEGY_LIBRARY: Record<StrategyFamily, Omit<StrategyCandidate, "id" | "prior" | "explorationBonus" | "score">> = {
  mirror: { family: "mirror", label: "顺着对方的节奏", intent: "维持同频，跟住当前节奏", tactic: "复用对方的语气和信息量", tone: "自然、短", risk: "可能推进较慢", informationGain: .28 },
  warm: { family: "warm", label: "先接住感受", intent: "降低压力并表达在场", tactic: "确认感受，先陪住再说事", tone: "温和、有分寸", risk: "过度安慰会显得用力", informationGain: .22 },
  playful: { family: "playful", label: "轻松接梗", intent: "用低负担互动恢复节奏", tactic: "轻微自嘲或镜像玩笑", tone: "松弛、有分寸", risk: "严肃情境下容易接不住", informationGain: .32 },
  direct: { family: "direct", label: "把意思说清楚", intent: "减少猜测和歧义", tactic: "简短表达立场或需求", tone: "坦率、干脆", risk: "对方压力高时可能太重", informationGain: .55 },
  invite: { family: "invite", label: "给一个轻量邀约", intent: "用行动验证互动意愿", tactic: "具体但容易接的小邀约", tone: "轻松、留退路", risk: "势头不足时会暴露推进压力", informationGain: .72 },
  clarify: { family: "clarify", label: "问一个容易回答的问题", intent: "补足关键背景", tactic: "一次只问一个事实问题", tone: "好奇、自然", risk: "问题太多会造成负担", informationGain: .76 },
  give_space: { family: "give_space", label: "留一点空间", intent: "在高压或低投入时先收力", tactic: "短句收住并留一个回来的入口", tone: "平静、体面", risk: "可能暂时中断互动", informationGain: .16 },
  seek_more_context: { family: "seek_more_context", label: "先补一条关键信息", intent: "信息不足时先取证再判断", tactic: "向用户确认最能区分两种解释的事实", tone: "诚实、具体", risk: "这一轮先拿不到完整结论", informationGain: .92 },
};

export interface RewardWeights {
  goalAlignment: number; evidenceUse: number; consistency: number; naturalness: number;
  informationValue: number; learnedPrior: number; riskPenalty: number;
}

export const DEFAULT_REWARD_WEIGHTS: RewardWeights = {
  goalAlignment: .29, evidenceUse: .14, consistency: .13, naturalness: .15,
  informationValue: .12, learnedPrior: .1, riskPenalty: .22,
};

/** Boldness reshapes the objective: a bold profile pays less for risk, values
 * information slightly less, and acts sooner; a cautious one is the reverse. */
export function rewardWeightsFor(boldness = .5): RewardWeights {
  return {
    ...DEFAULT_REWARD_WEIGHTS,
    riskPenalty: DEFAULT_REWARD_WEIGHTS.riskPenalty * (1.45 - .9 * boldness),
    informationValue: DEFAULT_REWARD_WEIGHTS.informationValue * (1.2 - .4 * boldness),
  };
}

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
  model?: WorldModelSnapshot,
  boldness = .5,
): StrategyCandidate[] {
  const pressure = state(states, "emotional_pressure").mean;
  const guardedness = state(states, "boundary_sensitivity").mean;
  const momentum = state(states, "momentum").mean;
  const engagement = state(states, "engagement").mean;
  const dominant = hypotheses[0]?.id ?? "unknown";
  const families = new Set<StrategyFamily>(["mirror", "clarify", "give_space"]);
  if (pressure > .15) families.add("warm");
  else families.add("playful");
  if (momentum > .15 - .48 * (boldness - .5) && engagement > -.1) families.add("invite");
  if (mode === "ask" || mode === "interest" || boldness >= .72) families.add("direct");
  if (expectedValueOfInformation(states, hypotheses, missing.length, planningMode, model, boldness) >= VOI_GATE) {
    families.add("seek_more_context");
  }

  const context = `${planningMode}:${dominant}`;
  const drive = boldness - .5; // signed risk appetite around the neutral profile
  return [...families].map((family) => {
    const base = STRATEGY_LIBRARY[family];
    const posterior = lookupPosterior(profileSlug, context, family);
    const explorationBonus = Math.min(.2, .16 * (.7 + .6 * boldness) / Math.sqrt(posterior.samples + 1));
    const situational = family === "warm" ? .14 * pressure
      : family === "give_space" ? .12 * pressure + .1 * guardedness - .08 * momentum - .1 * drive
      : family === "invite" ? .14 * momentum + .1 * engagement - .16 * pressure + .14 * drive
      : family === "playful" ? .08 * engagement - .13 * pressure + .04 * drive
      : family === "direct" ? .09 * drive
      : family === "seek_more_context" ? missing.length * .035 - .06 * drive
      : 0;
    const patternAdjustment = patterns.filter((item) => item.lifecycle === "active").reduce((sum, pattern) => {
      if (pattern.id === "slow-response" && ["give_space", "mirror"].includes(family)) return sum + .06 * pattern.confidence;
      if (pattern.id === "no-reply" && ["give_space", "clarify"].includes(family)) return sum + .08 * pattern.confidence;
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

/** Gate above which a clarifying exchange beats acting now. EVOI is an absolute
 * expected-return improvement in [0,1] value units, so the bar is deliberately low. */
const VOI_GATE = .02;

/** Expected value of one clarifying question. Kept as a planner export; the
 * computation lives in the world model (Bayes regime update over imagined answers). */
export function valueOfInformation(
  states: BeliefState[], hypotheses: StateHypothesis[], missingCount: number,
  mode: PlanningMode, model?: WorldModelSnapshot, boldness = .5,
): number {
  return expectedValueOfInformation(states, hypotheses, missingCount, mode, model, boldness);
}

/** Belief-space rollouts through the learned world model. Depth and regime
 * branching follow the planning budget; see worldmodel.ts for the dynamics. */
export function simulateStrategies(
  strategies: StrategyCandidate[],
  hypotheses: StateHypothesis[],
  states: BeliefState[],
  planningMode: PlanningMode,
  model?: WorldModelSnapshot,
): SimulationBranch[] {
  return rolloutStrategies(strategies, hypotheses, states, planningMode, { snapshot: model });
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
    // Branches only cover the top regimes, so normalize by the covered mass.
    const mass = branches.reduce((sum, branch) => sum + branch.probability, 0) || 1;
    const expected = branches.reduce((sum, branch) => sum + branch.probability * branch.delayedReward, 0) / mass;
    const risk = branches.reduce((sum, branch) => sum + branch.probability * branch.risk, 0) / mass;
    const evidenceUse = clamp(.24 + evidence.length / 18);
    const naturalness = ["mirror", "playful", "give_space"].includes(strategy.family) ? .86
      : strategy.family === "seek_more_context" ? .72 : .78;
    const consistency = clamp(.55 + (strategy.prior - .5) * .45);
    const goalAlignment = clamp(expected + (antiSimp && strategy.family === "give_space" ? .08 : 0));
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
  boldness = .5,
): UncertaintyReport {
  const sorted = [...strategies].sort((a, b) => b.score - a.score);
  const scoreMargin = clamp((sorted[0]?.score ?? 0) - (sorted[1]?.score ?? 0));
  const conflict = states.filter((item) => item.conflicted).length / Math.max(1, states.length);
  const topBranches = simulations.filter((item) => item.strategyId === sorted[0]?.id);
  const mass = topBranches.reduce((s, b) => s + b.probability, 0) || 1;
  const mean = topBranches.reduce((s, b) => s + b.probability * b.delayedReward, 0) / mass;
  // Law of total variance over the rollout: regime disagreement (between) plus
  // response stochasticity inside each regime branch (within, from the model).
  const between = topBranches.reduce((s, b) => s + b.probability * (b.delayedReward - mean) ** 2, 0) / mass;
  const within = topBranches.reduce((s, b) => s + b.probability * (b.valueVariance ?? 0), 0) / mass;
  const variance = between + within;
  const coverage = clamp(evidence.reduce((s, item) => s + item.reliability * (item.relevance ?? .4), 0) / 4.5);
  const stateEntropy = entropy(hypotheses);
  const total = clamp(.31 * stateEntropy + .2 * conflict + .19 * Math.min(1, variance * 5)
    + .18 * (1 - coverage) + .12 * (1 - Math.min(1, scoreMargin * 6)));
  // A bolder profile tolerates more uncertainty before it pauses to gather info.
  const abstainBar = .76 + .14 * (boldness - .5);
  const abstain = evidence.length < 2 || (total > abstainBar && coverage < .42);
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
