/**
 * Learned generative world model for the decision engine.
 *
 * The previous "world model" was a static (strategy, hypothesis) → reward lookup.
 * This module replaces it with a small but genuine model of the interaction:
 *
 * 1. Regime-switching linear-Gaussian latent dynamics over the nine belief
 *    dimensions: s' = (I−Λ)s + Λ·s̄ + Gₕ·φ(a) + δ(f) + w. The regime h is the
 *    competing hypothesis; φ(a) is a fixed action-feature embedding; δ(f) is a
 *    per-profile residual learned from recorded outcomes.
 * 2. A response head p(o | s', h, f) over {positive, neutral, negative, no_reply}
 *    that mixes a structural softmax on the predicted state with a decayed
 *    Dirichlet-multinomial posterior estimated from this profile's real outcomes.
 * 3. Diagonal-Kalman belief updates on imagined observations, so rollouts move
 *    through belief space rather than reusing the current state at every depth.
 * 4. Finite-horizon rollouts with exact observation enumeration at the root and
 *    certainty-equivalent continuation deeper, plus a Bayes regime update after
 *    each imagined response.
 *
 * Everything is deterministic, dependency-free and cheap enough to run on every
 * keystroke-level decision; the LLM is still only used for realization.
 */

import {
  BELIEF_DIMENSIONS, type BeliefDimension, type BeliefState, type NetworkTrace,
  type PlanningMode, type ResponseClass, type SimulationBranch, type StateHypothesis,
  type StrategyCandidate, type StrategyFamily, type TraceEdge, type TraceNode,
  type UncertaintyReport, type WorldModelSnapshot, type LearnedRegimeFamily,
} from "./types";
import { REGIME_SCORING } from "./state";

export const RESPONSE_CLASSES: ResponseClass[] = ["positive", "neutral", "negative", "no_reply"];

const D = BELIEF_DIMENSIONS.length;
const INDEX: Record<BeliefDimension, number> = Object.fromEntries(
  BELIEF_DIMENSIONS.map((dimension, index) => [dimension, index]),
) as Record<BeliefDimension, number>;

export interface GaussianBelief { mean: Float64Array; variance: Float64Array }

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function clampState(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Standard normal CDF via the Abramowitz–Stegun erf approximation (|ε|<1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + .3275911 * Math.abs(z));
  const poly = t * (.254829592 + t * (-.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return .5 * (1 + (z < 0 ? -erf : erf));
}

export function beliefFromStates(states: BeliefState[]): GaussianBelief {
  const mean = new Float64Array(D);
  const variance = new Float64Array(D);
  for (const state of states) {
    mean[INDEX[state.dimension]] = state.mean;
    // Filtered posterior variance shrinks with effective sample mass; a floor keeps
    // the model from ever claiming certainty about another person.
    variance[INDEX[state.dimension]] = clamp(state.variance / (1 + .55 * state.effectiveSampleSize), .04, 1);
  }
  if (!states.length) { variance.fill(.6); }
  return { mean, variance };
}

// ---------------------------------------------------------------------------
// Action embedding φ(a) and regime-conditioned dynamics prior
// ---------------------------------------------------------------------------

const ACTION_FEATURES = ["soothe", "advance", "warmth", "probe", "assert", "withdraw"] as const;
type ActionFeature = typeof ACTION_FEATURES[number];

const FAMILY_FEATURES: Record<StrategyFamily, Partial<Record<ActionFeature, number>>> = {
  mirror: { soothe: .1, advance: .05, warmth: .15, probe: .05, withdraw: .05 },
  warm: { soothe: .6, warmth: .8, probe: .05, assert: .05 },
  playful: { soothe: .15, advance: .2, warmth: .4, probe: .05, assert: .05 },
  direct: { advance: .35, warmth: .1, probe: .15, assert: .8 },
  invite: { advance: .9, warmth: .25, probe: .1, assert: .35 },
  clarify: { soothe: .15, advance: .05, warmth: .15, probe: .85, assert: .1 },
  give_space: { soothe: .55, advance: -.3, warmth: .15, assert: .05, withdraw: .9 },
  // Asking the user does not send anything to the partner: null action, drift only.
  seek_more_context: {},
};

/** Base gain G: how one unit of each action feature moves each state dimension. */
const BASE_GAIN: Record<ActionFeature, Partial<Record<BeliefDimension, number>>> = {
  soothe: { emotional_pressure: -.3, boundary_sensitivity: -.1, trust: .05, communication_willingness: .06 },
  advance: { momentum: .3, engagement: .1, emotional_pressure: .1, boundary_sensitivity: .05, initiative: .04 },
  warmth: { trust: .12, engagement: .1, emotional_pressure: -.05 },
  probe: { communication_willingness: .14, engagement: .04, emotional_pressure: .05 },
  assert: { communication_willingness: .1, consistency: .05, emotional_pressure: .12, trust: .05, boundary_sensitivity: .05 },
  withdraw: { emotional_pressure: -.2, momentum: -.2, engagement: -.1, communication_willingness: -.08, boundary_sensitivity: -.08 },
};

interface RegimePrior {
  multipliers: Partial<Record<ActionFeature, number>>;
  overrides: Array<{ feature: ActionFeature; dimension: BeliefDimension; gain: number }>;
}

/** Regime-switching prior: the same action has different dynamics per hypothesis. */
const REGIME_PRIORS: Record<string, RegimePrior> = {
  receptive: {
    multipliers: { soothe: .7, advance: 1.3, warmth: 1.1, probe: .9, withdraw: 1.1 },
    overrides: [
      { feature: "advance", dimension: "emotional_pressure", gain: -.06 },
      { feature: "advance", dimension: "momentum", gain: .08 },
    ],
  },
  uncertain: {
    multipliers: { probe: 1.2, assert: 1.1, warmth: .9 },
    overrides: [
      { feature: "assert", dimension: "trust", gain: .05 },
      { feature: "probe", dimension: "communication_willingness", gain: .06 },
      { feature: "advance", dimension: "emotional_pressure", gain: .06 },
    ],
  },
  pressured: {
    multipliers: { soothe: 1.5, advance: 1.2, warmth: 1.2, assert: 1.1, withdraw: 1.3 },
    overrides: [
      { feature: "advance", dimension: "emotional_pressure", gain: .3 },
      { feature: "advance", dimension: "momentum", gain: -.24 },
      { feature: "assert", dimension: "emotional_pressure", gain: .14 },
      { feature: "warmth", dimension: "emotional_pressure", gain: -.08 },
      { feature: "probe", dimension: "emotional_pressure", gain: .05 },
    ],
  },
  disengaging: {
    multipliers: { warmth: .8, advance: 1.1 },
    overrides: [
      { feature: "advance", dimension: "engagement", gain: -.2 },
      { feature: "advance", dimension: "emotional_pressure", gain: .12 },
      { feature: "warmth", dimension: "engagement", gain: -.06 },
      { feature: "withdraw", dimension: "engagement", gain: .05 },
      { feature: "probe", dimension: "engagement", gain: -.04 },
    ],
  },
};

const NEUTRAL_REGIME: RegimePrior = { multipliers: {}, overrides: [] };

/** Per-exchange mean reversion Λ toward the neutral baseline s̄ = 0. */
const REVERSION: Record<BeliefDimension, number> = {
  engagement: .1, trust: .03, communication_willingness: .12, emotional_pressure: .3,
  boundary_sensitivity: .08, commitment_reliability: .02, momentum: .18, initiative: .06, consistency: .02,
};

/** Process noise Q: irreducible per-step variance of another person's state. */
const PROCESS_NOISE: Record<BeliefDimension, number> = {
  engagement: .03, trust: .015, communication_willingness: .03, emotional_pressure: .05,
  boundary_sensitivity: .02, commitment_reliability: .01, momentum: .04, initiative: .02, consistency: .01,
};

/** Shrinkage weight for learned corrections: n/(n+n0), zero data ⇒ pure prior. */
function learnedWeight(effective: number, n0 = 8): number {
  return effective / (effective + n0);
}

export function transition(
  belief: GaussianBelief, family: StrategyFamily, regime: string,
  learned?: LearnedRegimeFamily,
): GaussianBelief {
  const prior = REGIME_PRIORS[regime] ?? NEUTRAL_REGIME;
  const features = FAMILY_FEATURES[family];
  const mean = new Float64Array(D);
  const variance = new Float64Array(D);
  const residualWeight = learned ? learnedWeight(learned.effective) : 0;
  for (const dimension of BELIEF_DIMENSIONS) {
    const index = INDEX[dimension];
    const keep = 1 - REVERSION[dimension];
    let drift = keep * belief.mean[index];
    for (const feature of ACTION_FEATURES) {
      const strength = features[feature] ?? 0;
      if (!strength) continue;
      const base = (BASE_GAIN[feature][dimension] ?? 0) * (prior.multipliers[feature] ?? 1);
      drift += strength * base;
    }
    for (const override of prior.overrides) {
      if (override.dimension !== dimension) continue;
      drift += (features[override.feature] ?? 0) * override.gain;
    }
    if (residualWeight && learned?.delta[dimension] !== undefined) {
      drift += residualWeight * Number(learned.delta[dimension]);
    }
    mean[index] = clampState(drift);
    variance[index] = clamp(keep * keep * belief.variance[index] + PROCESS_NOISE[dimension], .02, 1.2);
  }
  return { mean, variance };
}

// ---------------------------------------------------------------------------
// Response model p(o | s', h, f): structural softmax ⊕ Dirichlet-multinomial
// ---------------------------------------------------------------------------

const RESPONSE_HEAD: Record<ResponseClass, { intercept: number; loadings: Partial<Record<BeliefDimension, number>> }> = {
  positive: {
    intercept: .1,
    loadings: { engagement: .95, momentum: .7, communication_willingness: .55, trust: .3, emotional_pressure: -.65, boundary_sensitivity: -.2, initiative: .15 },
  },
  neutral: { intercept: .55, loadings: { emotional_pressure: -.15, engagement: .05 } },
  negative: {
    intercept: -.75,
    loadings: { emotional_pressure: .95, boundary_sensitivity: .55, engagement: -.25, trust: -.25, consistency: -.1 },
  },
  no_reply: {
    intercept: -.85,
    loadings: { engagement: -.95, communication_willingness: -.85, momentum: -.45, emotional_pressure: .2, initiative: -.35 },
  },
};

const DIRICHLET_PRIOR = .75; // symmetric α₀ for the empirical head

export function responseDistribution(
  predicted: GaussianBelief, learned?: LearnedRegimeFamily,
): Record<ResponseClass, number> {
  const logits = RESPONSE_CLASSES.map((cls) => {
    const head = RESPONSE_HEAD[cls];
    let z = head.intercept;
    for (const [dimension, loading] of Object.entries(head.loadings)) {
      z += Number(loading) * predicted.mean[INDEX[dimension as BeliefDimension]];
    }
    return z;
  });
  const max = Math.max(...logits);
  const exp = logits.map((z) => Math.exp(z - max));
  const total = exp.reduce((a, b) => a + b, 0);
  const structural = exp.map((value) => value / total);
  const counts = learned?.counts;
  const observed = counts ? RESPONSE_CLASSES.reduce((sum, cls) => sum + (counts[cls] ?? 0), 0) : 0;
  const mix = observed ? learnedWeight(observed, 6) : 0;
  return Object.fromEntries(RESPONSE_CLASSES.map((cls, index) => {
    const empirical = observed
      ? ((counts?.[cls] ?? 0) + DIRICHLET_PRIOR) / (observed + DIRICHLET_PRIOR * RESPONSE_CLASSES.length)
      : 0;
    return [cls, (1 - mix) * structural[index] + mix * empirical];
  })) as Record<ResponseClass, number>;
}

// ---------------------------------------------------------------------------
// Imagined-observation belief update (diagonal Kalman / information form)
// ---------------------------------------------------------------------------

const OBSERVATION_MODEL: Record<ResponseClass, Array<{ dimension: BeliefDimension; value: number; noise: number }>> = {
  positive: [
    { dimension: "engagement", value: .6, noise: .15 }, { dimension: "communication_willingness", value: .5, noise: .2 },
    { dimension: "momentum", value: .5, noise: .2 }, { dimension: "emotional_pressure", value: -.25, noise: .3 },
  ],
  neutral: [
    { dimension: "engagement", value: .05, noise: .6 }, { dimension: "emotional_pressure", value: -.05, noise: .6 },
  ],
  negative: [
    { dimension: "emotional_pressure", value: .6, noise: .15 }, { dimension: "boundary_sensitivity", value: .35, noise: .25 },
    { dimension: "engagement", value: -.25, noise: .3 },
  ],
  no_reply: [
    { dimension: "engagement", value: -.65, noise: .15 }, { dimension: "communication_willingness", value: -.7, noise: .15 },
    { dimension: "momentum", value: -.45, noise: .2 }, { dimension: "initiative", value: -.3, noise: .3 },
  ],
};

export function observationUpdate(belief: GaussianBelief, response: ResponseClass): GaussianBelief {
  const mean = Float64Array.from(belief.mean);
  const variance = Float64Array.from(belief.variance);
  for (const obs of OBSERVATION_MODEL[response]) {
    const index = INDEX[obs.dimension];
    const gain = variance[index] / (variance[index] + obs.noise);
    mean[index] = clampState(mean[index] + gain * (obs.value - mean[index]));
    variance[index] = clamp((1 - gain) * variance[index], .02, 1.2);
  }
  return { mean, variance };
}

/** Expected (probability-weighted) observation update: the certainty-equivalent
 * belief used for continuation values below the root of the rollout tree. */
function expectedObservationUpdate(
  belief: GaussianBelief, distribution: Record<ResponseClass, number>,
): GaussianBelief {
  const mean = Float64Array.from(belief.mean);
  const variance = Float64Array.from(belief.variance);
  for (const cls of RESPONSE_CLASSES) {
    const p = distribution[cls];
    if (p < .02) continue;
    for (const obs of OBSERVATION_MODEL[cls]) {
      const index = INDEX[obs.dimension];
      const gain = p * variance[index] / (variance[index] + obs.noise);
      mean[index] = clampState(mean[index] + gain * (obs.value - mean[index]));
      variance[index] = clamp((1 - gain) * variance[index], .02, 1.2);
    }
  }
  return { mean, variance };
}

// ---------------------------------------------------------------------------
// Reward, risk and rollout value
// ---------------------------------------------------------------------------

const RESPONSE_UTILITY: Record<ResponseClass, number> = { positive: 1, neutral: .55, negative: .08, no_reply: .15 };

const STATE_VALUE: Partial<Record<BeliefDimension, number>> = {
  engagement: .3, trust: .2, communication_willingness: .12, commitment_reliability: .08,
  momentum: .2, initiative: .06, consistency: .06, emotional_pressure: -.34, boundary_sensitivity: -.06,
};

function stateValue(belief: GaussianBelief): number {
  let value = 0;
  for (const [dimension, weight] of Object.entries(STATE_VALUE)) {
    value += Number(weight) * belief.mean[INDEX[dimension as BeliefDimension]];
  }
  // Extra hinge: sustained pressure is worse than the linear term admits.
  value -= .25 * Math.max(0, belief.mean[INDEX.emotional_pressure] - .5);
  return clamp((value + 1) / 2);
}

function reward(response: ResponseClass, updated: GaussianBelief): number {
  return clamp(.58 * RESPONSE_UTILITY[response] + .42 * stateValue(updated));
}

/** P(pressure' > τ) under the propagated Gaussian: risk uses real model variance. */
function pressureExceedance(predicted: GaussianBelief, threshold = .6): number {
  const index = INDEX.emotional_pressure;
  const sigma = Math.sqrt(predicted.variance[index]);
  return normalCdf((predicted.mean[index] - threshold) / Math.max(1e-6, sigma));
}

function branchRisk(distribution: Record<ResponseClass, number>, predicted: GaussianBelief): number {
  return clamp(.9 * distribution.negative + .7 * distribution.no_reply + .5 * pressureExceedance(predicted));
}

const DISCOUNT = .68;
const CONTINUATION_FAMILIES: StrategyFamily[] = ["mirror", "warm", "invite", "give_space", "clarify"];

export interface WorldModelOptions {
  snapshot?: WorldModelSnapshot;
}

function learnedFor(snapshot: WorldModelSnapshot | undefined, regime: string, family: StrategyFamily): LearnedRegimeFamily | undefined {
  return snapshot?.entries[`${regime}:${family}`];
}

/** Bayes update of the regime posterior given an imagined response:
 * p(h|o,a) ∝ p(o|h,a)·p(h). Keeps continuation values honest about what an
 * observation would actually tell us about which hypothesis is true. */
function regimePosterior(
  belief: GaussianBelief, family: StrategyFamily, response: ResponseClass,
  hypotheses: StateHypothesis[], snapshot?: WorldModelSnapshot,
): Array<{ id: string; probability: number }> {
  const scored = hypotheses.map((hypothesis) => {
    const predicted = transition(belief, family, hypothesis.id, learnedFor(snapshot, hypothesis.id, family));
    const likelihood = responseDistribution(predicted, learnedFor(snapshot, hypothesis.id, family))[response];
    return { id: hypothesis.id, probability: Math.max(1e-4, likelihood) * Math.max(1e-4, hypothesis.probability) };
  });
  const total = scored.reduce((sum, item) => sum + item.probability, 0);
  return scored.map((item) => ({ id: item.id, probability: item.probability / total }));
}

/** Certainty-equivalent continuation: greedy over a reduced action set, expected
 * observation collapse instead of enumeration. Depth is bounded by budget. */
function continuationValue(
  belief: GaussianBelief, regimes: Array<{ id: string; probability: number }>,
  depth: number, snapshot?: WorldModelSnapshot,
): number {
  if (depth <= 0) return stateValue(belief); // terminal value: V₀(b) = v(μ)
  let best = 0;
  for (const family of CONTINUATION_FAMILIES) {
    let value = 0;
    for (const regime of regimes) {
      if (regime.probability < .05) continue;
      const learned = learnedFor(snapshot, regime.id, family);
      const predicted = transition(belief, family, regime.id, learned);
      const distribution = responseDistribution(predicted, learned);
      const updated = expectedObservationUpdate(predicted, distribution);
      const immediate = RESPONSE_CLASSES.reduce((sum, cls) => sum + distribution[cls] * RESPONSE_UTILITY[cls], 0);
      const step = clamp(.58 * immediate + .42 * stateValue(updated));
      value += regime.probability * (step + DISCOUNT * continuationValue(updated, regimes, depth - 1, snapshot));
    }
    best = Math.max(best, value);
  }
  return best; // discounted, unnormalized; the root divides by horizonMass()
}

export function rolloutDepth(mode: PlanningMode): number {
  return mode === "fast" ? 1 : mode === "balanced" ? 2 : 3;
}

/** Max attainable discounted return of a depth-D rollout: Σ_{k<D} γᵏ·1 + γᴰ·V₀,
 * with V₀ ≤ 1. Used to keep every value estimate normalized to [0,1]. */
function horizonMass(depth: number): number {
  return depth <= 1 ? 1 : (1 - Math.pow(DISCOUNT, depth)) / (1 - DISCOUNT) + Math.pow(DISCOUNT, depth);
}

/** Belief-space rollout for every candidate strategy. Emits one branch per
 * (strategy, regime) with the full response distribution, the predicted next
 * state, a normalized finite-horizon value and a variance decomposition. */
export function rolloutStrategies(
  strategies: StrategyCandidate[],
  hypotheses: StateHypothesis[],
  states: BeliefState[],
  planningMode: PlanningMode,
  options: WorldModelOptions = {},
): SimulationBranch[] {
  const belief = beliefFromStates(states);
  const depth = rolloutDepth(planningMode);
  const regimeLimit = planningMode === "fast" ? 2 : planningMode === "balanced" ? 3 : 4;
  const mass = horizonMass(depth);
  const branches: SimulationBranch[] = [];
  for (const strategy of strategies) {
    for (const hypothesis of hypotheses.slice(0, regimeLimit)) {
      const learned = learnedFor(options.snapshot, hypothesis.id, strategy.family);
      const predicted = transition(belief, strategy.family, hypothesis.id, learned);
      const distribution = responseDistribution(predicted, learned);
      let value = 0;
      let immediate = 0;
      let secondMoment = 0;
      for (const cls of RESPONSE_CLASSES) {
        const p = distribution[cls];
        const updated = observationUpdate(predicted, cls);
        const r = reward(cls, updated);
        immediate += p * r;
        let branchValue = r;
        if (depth > 1) {
          const regimes = regimePosterior(belief, strategy.family, cls, hypotheses.slice(0, regimeLimit), options.snapshot);
          branchValue += DISCOUNT * continuationValue(updated, regimes, depth - 1, options.snapshot);
        }
        value += p * branchValue;
        secondMoment += p * branchValue * branchValue;
      }
      const normalized = clamp(value / mass);
      const valueVariance = Math.max(0, secondMoment - value * value) / (mass * mass);
      branches.push({
        id: crypto.randomUUID(), strategyId: strategy.id, hypothesisId: hypothesis.id,
        probability: hypothesis.probability,
        outcome: branchNarrative(strategy.family, hypothesis.id, distribution),
        immediateReward: clamp(immediate),
        delayedReward: normalized,
        risk: branchRisk(distribution, predicted),
        responseDistribution: distribution,
        predictedState: Object.fromEntries(BELIEF_DIMENSIONS.map((dimension) => [
          dimension, Math.round(predicted.mean[INDEX[dimension]] * 1000) / 1000,
        ])) as Partial<Record<BeliefDimension, number>>,
        valueVariance: Math.round(valueVariance * 10_000) / 10_000,
        horizon: depth,
      });
    }
  }
  return branches;
}

function branchNarrative(family: StrategyFamily, regime: string, distribution: Record<ResponseClass, number>): string {
  const top = RESPONSE_CLASSES.reduce((best, cls) => distribution[cls] > distribution[best] ? cls : best, "neutral" as ResponseClass);
  const label: Record<ResponseClass, string> = {
    positive: "较可能得到积极回应", neutral: "较可能得到平稳回应",
    negative: "存在明显负面反应风险", no_reply: "存在不回复风险",
  };
  return `${regime} 成立时，模型预测${label[top]}（${Math.round(distribution[top] * 100)}%）`;
}

// ---------------------------------------------------------------------------
// Expected value of information (EVOI) for one clarifying exchange
// ---------------------------------------------------------------------------

const PROBE_FAMILY: StrategyFamily = "clarify";
const VOI_EVAL_FAMILIES: StrategyFamily[] = ["mirror", "warm", "playful", "direct", "invite", "give_space"];

function oneStepValue(
  belief: GaussianBelief, regimes: Array<{ id: string; probability: number }>,
  family: StrategyFamily, snapshot?: WorldModelSnapshot,
): number {
  let value = 0;
  for (const regime of regimes) {
    if (regime.probability < .03) continue;
    const learned = learnedFor(snapshot, regime.id, family);
    const predicted = transition(belief, family, regime.id, learned);
    const distribution = responseDistribution(predicted, learned);
    for (const cls of RESPONSE_CLASSES) {
      value += regime.probability * distribution[cls] * reward(cls, observationUpdate(predicted, cls));
    }
  }
  return value;
}

/** EVOI(q) = E_o[max_a Q(a | b post-answer)] − max_a Q(a | b) − c(q), computed by
 * enumerating the probe's response classes and Bayes-updating the regime posterior.
 * Boldness raises the cost of stopping to ask: a bold profile prefers acting now. */
export function expectedValueOfInformation(
  states: BeliefState[], hypotheses: StateHypothesis[],
  missingCount: number, mode: PlanningMode, snapshot?: WorldModelSnapshot,
  boldness = .5,
): number {
  if (!hypotheses.length) return 0;
  const belief = beliefFromStates(states);
  const prior = hypotheses.map((h) => ({ id: h.id, probability: h.probability }));
  const priorBest = Math.max(...VOI_EVAL_FAMILIES.map((family) => oneStepValue(belief, prior, family, snapshot)));
  const probeDistributions = hypotheses.map((hypothesis) => {
    const learned = learnedFor(snapshot, hypothesis.id, PROBE_FAMILY);
    return responseDistribution(transition(belief, PROBE_FAMILY, hypothesis.id, learned), learned);
  });
  let posteriorGain = 0;
  for (const cls of RESPONSE_CLASSES) {
    const marginal = hypotheses.reduce((sum, h, index) => sum + h.probability * probeDistributions[index][cls], 0);
    if (marginal < .01) continue;
    const posterior = hypotheses.map((h, index) => ({
      id: h.id, probability: h.probability * probeDistributions[index][cls] / marginal,
    }));
    const updated = observationUpdate(belief, cls);
    const best = Math.max(...VOI_EVAL_FAMILIES.map((family) => oneStepValue(updated, posterior, family, snapshot)));
    posteriorGain += marginal * best;
  }
  // An answer can only separate hypotheses the user can actually inform.
  const answerability = .5 + .5 * Math.min(1, missingCount / 3);
  const baseCost = mode === "fast" ? .02 : mode === "deep" ? .006 : .012;
  const askCost = baseCost * (.6 + .8 * boldness);
  return Math.max(0, (posteriorGain - priorBest) * answerability - askCost);
}

// ---------------------------------------------------------------------------
// Decision-network trace: the actual dataflow of this round, for inspection
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Record<BeliefDimension, string> = {
  engagement: "互动投入", trust: "信任", communication_willingness: "沟通意愿",
  emotional_pressure: "情绪压力", boundary_sensitivity: "戒备程度", commitment_reliability: "承诺可靠",
  momentum: "互动势头", initiative: "主动程度", consistency: "一致性",
};

const FEATURE_LABELS: Record<ActionFeature, string> = {
  soothe: "安抚缓压", advance: "推进", warmth: "温度", probe: "探询", assert: "直接表达", withdraw: "收力",
};

const RESPONSE_LABELS: Record<ResponseClass, string> = {
  positive: "积极回应", neutral: "平稳回应", negative: "负面反应", no_reply: "未回复",
};

/** Mixture gain of one action feature on one dimension under the current
 * regime posterior — exactly the coefficients the transition applied. */
function mixedGain(feature: ActionFeature, dimension: BeliefDimension, regimes: Array<{ id: string; probability: number }>): number {
  let gain = 0;
  for (const regime of regimes) {
    const prior = REGIME_PRIORS[regime.id] ?? NEUTRAL_REGIME;
    let g = (BASE_GAIN[feature][dimension] ?? 0) * (prior.multipliers[feature] ?? 1);
    for (const override of prior.overrides) {
      if (override.feature === feature && override.dimension === dimension) g += override.gain;
    }
    gain += regime.probability * g;
  }
  return gain;
}

/** Builds the layered activation graph of one completed decision. Every node
 * activation and edge weight is read back from the quantities the engine
 * actually computed, so clicking through the graph audits the real math. */
export function buildNetworkTrace(options: {
  states: BeliefState[];
  hypotheses: StateHypothesis[];
  selected: StrategyCandidate;
  branches: SimulationBranch[];
  uncertainty: UncertaintyReport;
  snapshot?: WorldModelSnapshot;
}): NetworkTrace {
  const { states, hypotheses, selected, branches, uncertainty, snapshot } = options;
  const edges: TraceEdge[] = [];
  const pushEdge = (from: string, to: string, weight: number) => {
    if (Math.abs(weight) >= .04) edges.push({ from, to, weight: Math.max(-1, Math.min(1, weight)) });
  };

  const beliefNodes: TraceNode[] = states.map((state) => ({
    id: `b:${state.dimension}`, label: DIMENSION_LABELS[state.dimension],
    activation: state.mean,
    detail: [
      `均值 ${state.mean.toFixed(2)}（短期 ${state.shortTerm.toFixed(2)} / 长期 ${state.longTerm.toFixed(2)}）`,
      `方差 ${state.variance.toFixed(2)} · 置信度 ${(state.confidence * 100).toFixed(0)}%`,
      `有效样本 ${state.effectiveSampleSize.toFixed(1)} · 证据 ${state.evidenceCount} 条`,
      ...(state.changing ? ["检测到近期变化：短期权重升至 0.72"] : []),
      ...(state.conflicted ? ["存在方向冲突的证据，两侧都保留"] : []),
    ],
  }));

  const regimeNodes: TraceNode[] = hypotheses.map((hypothesis) => ({
    id: `h:${hypothesis.id}`, label: hypothesis.label,
    activation: hypothesis.probability,
    detail: [
      `后验概率 ${(hypothesis.probability * 100).toFixed(0)}%`,
      hypothesis.explanation,
      `支持证据 ${hypothesis.supportingEvidenceIds.length} 条 · 反证 ${hypothesis.contradictingEvidenceIds.length} 条`,
    ],
  }));
  for (const hypothesis of hypotheses) {
    const scoring = REGIME_SCORING[hypothesis.id] ?? {};
    for (const [dimension, coefficient] of Object.entries(scoring)) {
      pushEdge(`b:${dimension}`, `h:${hypothesis.id}`, Number(coefficient) / 1.25);
    }
  }

  const features = FAMILY_FEATURES[selected.family];
  const activeFeatures = ACTION_FEATURES.filter((feature) => Math.abs(features[feature] ?? 0) >= .04);
  const strategyNode: TraceNode = {
    id: `a:${selected.family}`, label: `策略：${selected.label}`,
    activation: selected.score,
    detail: [
      `综合得分 ${selected.score.toFixed(2)} · 学习先验 ${selected.prior.toFixed(2)}`,
      `探索奖励 ${selected.explorationBonus.toFixed(3)}`,
      `动作特征 φ：${activeFeatures.map((f) => `${FEATURE_LABELS[f]} ${Number(features[f]).toFixed(2)}`).join(" · ") || "无（先补信息）"}`,
    ],
  };
  const selectedBranches = branches.filter((branch) => branch.strategyId === selected.id && branch.responseDistribution);
  const branchMass = selectedBranches.reduce((sum, branch) => sum + branch.probability, 0) || 1;
  for (const branch of selectedBranches) {
    pushEdge(`h:${branch.hypothesisId}`, strategyNode.id, branch.delayedReward * (branch.probability / branchMass) * 2);
  }

  const learnedSelected = selectedBranches.length
    ? learnedFor(snapshot, selectedBranches[0].hypothesisId, selected.family) : undefined;
  const featureNodes: TraceNode[] = activeFeatures.map((feature) => {
    const strength = Number(features[feature]);
    return {
      id: `f:${feature}`, label: FEATURE_LABELS[feature],
      activation: strength,
      detail: [
        `特征强度 φ=${strength.toFixed(2)}`,
        `按体制调制后作用于状态转移（G_h·φ）`,
        ...(learnedSelected?.effective ? [`该情境已学习样本 ${learnedSelected.effective.toFixed(1)} 条`] : []),
      ],
    };
  });
  for (const feature of activeFeatures) {
    pushEdge(strategyNode.id, `f:${feature}`, Number(features[feature]));
  }

  const regimeMixture = hypotheses.map((h) => ({ id: h.id, probability: h.probability }));
  const mixedPredicted: Partial<Record<BeliefDimension, number>> = {};
  for (const branch of selectedBranches) {
    for (const [dimension, value] of Object.entries(branch.predictedState ?? {})) {
      mixedPredicted[dimension as BeliefDimension] =
        (mixedPredicted[dimension as BeliefDimension] ?? 0) + (branch.probability / branchMass) * Number(value);
    }
  }
  const predictedDims = BELIEF_DIMENSIONS.filter((dimension) => {
    const current = states.find((s) => s.dimension === dimension)?.mean ?? 0;
    const predicted = mixedPredicted[dimension] ?? 0;
    return Math.abs(predicted) >= .05 || Math.abs(predicted - current) >= .04;
  });
  const predictedNodes: TraceNode[] = predictedDims.map((dimension) => {
    const current = states.find((s) => s.dimension === dimension)?.mean ?? 0;
    const predicted = mixedPredicted[dimension] ?? 0;
    const delta = predicted - current;
    return {
      id: `p:${dimension}`, label: `${DIMENSION_LABELS[dimension]}′`,
      activation: predicted,
      detail: [
        `预测均值 ${predicted.toFixed(2)}（当前 ${current.toFixed(2)}，Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}）`,
        `含均值回复 (1−λ)、体制增益 G_h·φ 与学习残差 δ`,
      ],
    };
  });
  for (const feature of activeFeatures) {
    for (const dimension of predictedDims) {
      pushEdge(`f:${feature}`, `p:${dimension}`, mixedGain(feature, dimension, regimeMixture) * Number(features[feature]) / .45);
    }
  }

  const mixedResponse: Partial<Record<ResponseClass, number>> = {};
  for (const branch of selectedBranches) {
    for (const cls of RESPONSE_CLASSES) {
      mixedResponse[cls] = (mixedResponse[cls] ?? 0) + (branch.probability / branchMass) * (branch.responseDistribution?.[cls] ?? 0);
    }
  }
  const responseNodes: TraceNode[] = RESPONSE_CLASSES.map((cls) => {
    const counts = learnedSelected?.counts?.[cls];
    return {
      id: `o:${cls}`, label: RESPONSE_LABELS[cls],
      activation: mixedResponse[cls] ?? 0,
      detail: [
        `预测概率 ${((mixedResponse[cls] ?? 0) * 100).toFixed(0)}%`,
        `结构头 softmax(u_o·s′+c_o) 与经验计数收缩混合`,
        ...(counts !== undefined ? [`该情境真实计数 ${Number(counts).toFixed(1)}（衰减后）`] : ["该情境暂无真实样本，按结构先验预测"]),
      ],
    };
  });
  for (const cls of RESPONSE_CLASSES) {
    for (const [dimension, loading] of Object.entries(RESPONSE_HEAD[cls].loadings)) {
      if (!predictedDims.includes(dimension as BeliefDimension)) continue;
      pushEdge(`p:${dimension}`, `o:${cls}`, Number(loading) / .95 * .8);
    }
  }

  const expectedValue = selectedBranches.reduce((sum, branch) => sum + (branch.probability / branchMass) * branch.delayedReward, 0);
  const expectedRisk = selectedBranches.reduce((sum, branch) => sum + (branch.probability / branchMass) * branch.risk, 0);
  const outputNodes: TraceNode[] = [
    {
      id: "out:value", label: "期望价值", activation: expectedValue,
      detail: [
        `归一化 rollout 价值 ${expectedValue.toFixed(2)}（深度 ${selectedBranches[0]?.horizon ?? 1}）`,
        `r = 0.58·u(o) + 0.42·v(s″)，γ=0.68`,
      ],
    },
    {
      id: "out:risk", label: "风险", activation: expectedRisk,
      detail: [
        `风险 ${expectedRisk.toFixed(2)}`,
        `0.9·p(负面) + 0.7·p(未回复) + 0.5·P(压力越界)`,
      ],
    },
    {
      id: "out:uncertainty", label: "不确定性", activation: uncertainty.total,
      detail: [
        `总体 ${uncertainty.total.toFixed(2)} · 体制熵 ${uncertainty.stateEntropy.toFixed(2)}`,
        `rollout 全方差 ${uncertainty.simulationVariance.toFixed(3)} · 证据覆盖 ${(uncertainty.evidenceCoverage * 100).toFixed(0)}%`,
        ...(uncertainty.abstain ? [`触发收敛动作：${uncertainty.reason ?? "先补信息"}`] : []),
      ],
    },
  ];
  for (const cls of RESPONSE_CLASSES) {
    pushEdge(`o:${cls}`, "out:value", (RESPONSE_UTILITY[cls] - .5) * (mixedResponse[cls] ?? 0) * 2.2);
  }
  pushEdge("o:negative", "out:risk", .9 * (mixedResponse.negative ?? 0) * 2.2);
  pushEdge("o:no_reply", "out:risk", .7 * (mixedResponse.no_reply ?? 0) * 2.2);
  for (const hypothesis of hypotheses) {
    const p = hypothesis.probability;
    if (p > .01) pushEdge(`h:${hypothesis.id}`, "out:uncertainty", (-p * Math.log(p)) / Math.log(hypotheses.length || 2));
  }

  return {
    layers: [
      { id: "beliefs", label: "状态信念", nodes: beliefNodes },
      { id: "regimes", label: "体制假设", nodes: regimeNodes },
      { id: "strategy", label: "选中策略", nodes: [strategyNode] },
      { id: "features", label: "动作特征", nodes: featureNodes },
      { id: "predicted", label: "预测状态", nodes: predictedNodes },
      { id: "responses", label: "回应分布", nodes: responseNodes },
      { id: "outputs", label: "决策输出", nodes: outputNodes },
    ],
    edges,
  };
}
