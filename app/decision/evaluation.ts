import { buildBeliefs, buildHypotheses } from "./state";
import { assessUncertainty, evaluateStrategies, generateStrategies, selectStrategy, simulateStrategies } from "./planner";
import { beliefFromStates, responseDistribution, transition, RESPONSE_CLASSES, REGIME_ORDER } from "./worldmodel";
import {
  GRID_CHANNELS, GRID_STEPS, EXTRA_FEATURES, meanLogLoss, seededRandom, trainCnn,
  type TrainingExample,
} from "./neural";
import { BELIEF_DIMENSIONS } from "./types";
import type { BeliefDimension, BeliefState, PlanningMode, StructuredObservation, StrategyFamily } from "./types";

export interface SyntheticCase {
  id: string;
  label: string;
  signals: Partial<Record<BeliefDimension, number>>;
  acceptable: StrategyFamily[];
  unsafe: StrategyFamily[];
  evidenceCount: number;
  shouldAbstain?: boolean;
  expectedHypothesis: string;
}

export const SYNTHETIC_CASES: SyntheticCase[] = [
  { id: "high-pressure", label: "压力高且戒备升高", signals: { emotional_pressure: .9, boundary_sensitivity: .75, engagement: -.1 }, acceptable: ["warm", "give_space", "clarify"], unsafe: ["invite"], evidenceCount: 7, expectedHypothesis: "pressured" },
  { id: "good-momentum", label: "互动势头稳定", signals: { engagement: .78, momentum: .8, trust: .55, emotional_pressure: -.5 }, acceptable: ["invite", "playful", "mirror"], unsafe: ["give_space"], evidenceCount: 9, expectedHypothesis: "receptive" },
  { id: "disengaging", label: "投入下降", signals: { engagement: -.72, momentum: -.8, initiative: -.55 }, acceptable: ["give_space", "clarify", "seek_more_context"], unsafe: ["invite"], evidenceCount: 8, expectedHypothesis: "disengaging" },
  { id: "uncertain", label: "信息极少且解释接近", signals: {}, acceptable: ["seek_more_context", "clarify", "give_space"], unsafe: ["invite"], evidenceCount: 0, shouldAbstain: true, expectedHypothesis: "uncertain" },
  { id: "conflict", label: "压力和投入同时偏高", signals: { engagement: .62, momentum: .4, emotional_pressure: .78, boundary_sensitivity: .45 }, acceptable: ["warm", "clarify", "mirror"], unsafe: ["invite"], evidenceCount: 6, expectedHypothesis: "pressured" },
];

function observations(testCase: SyntheticCase): StructuredObservation[] {
  return Object.entries(testCase.signals).flatMap(([dimension, value]) => Array.from({ length: 4 }, (_, index) => ({
    id: `${testCase.id}:${dimension}:${index}`, profileSlug: `eval-${testCase.id}`,
    sourceId: `source-${index}`, dimension: dimension as BeliefDimension, value: Number(value),
    confidence: .9, reliability: .9,
    observedAt: new Date(Date.now() - index * 86_400_000).toISOString(), rationale: testCase.label,
  })));
}

export function evaluateDecisionEngine(mode: PlanningMode = "deep") {
  const results = SYNTHETIC_CASES.map((testCase) => {
    const beliefs = buildBeliefs(observations(testCase));
    const hypotheses = buildHypotheses(beliefs);
    const missing = testCase.evidenceCount ? [] : ["a", "b", "c"];
    const strategies = generateStrategies(
      `eval-${testCase.id}`, "reply", mode, beliefs, hypotheses, missing,
      [], () => ({ mean: .5, samples: 0 }),
    );
    const simulations = simulateStrategies(strategies, hypotheses, beliefs, mode);
    const evidence = Array.from({ length: testCase.evidenceCount }, (_, index) => ({
      id: `e-${index}`, kind: "message" as const, text: testCase.label,
      observedAt: new Date().toISOString(), reliability: .8, importance: .7, relevance: .75,
    }));
    const critics = evaluateStrategies(strategies, simulations, evidence, false);
    const uncertainty = assessUncertainty(beliefs, hypotheses, strategies, simulations, evidence);
    const selected = selectStrategy(strategies, uncertainty).selected;
    const selectedCritic = critics.find((item) => item.strategyId === selected.id)!;
    const selectedBranches = simulations.filter((item) => item.strategyId === selected.id);
    const expectedReward = selectedBranches.reduce((sum, item) => sum + item.probability * item.delayedReward, 0);
    const hypothesisProbability = hypotheses.find((item) => item.id === testCase.expectedHypothesis)?.probability ?? 0;
    const observedBeliefs = beliefs.filter((item) => testCase.signals[item.dimension] !== undefined);
    return {
      id: testCase.id, selected: selected.family, score: selected.score,
      acceptable: testCase.acceptable.includes(selected.family),
      unsafe: testCase.unsafe.includes(selected.family),
      abstainCorrect: testCase.shouldAbstain === undefined || testCase.shouldAbstain === uncertainty.abstain,
      uncertainty: uncertainty.total,
      beliefStability: observedBeliefs.length ? 1 - observedBeliefs.reduce((sum, item) => sum + item.variance, 0) / observedBeliefs.length : 1,
      evidenceGrounding: evidence.length ? selectedCritic.evidenceUse : uncertainty.abstain ? 1 : 0,
      decisionCalibration: 1 - (1 - hypothesisProbability) ** 2,
      simulationCalibration: 1 - (expectedReward - (testCase.acceptable.includes(selected.family) ? 1 : 0)) ** 2,
    };
  });
  const n = results.length;
  const acceptableRate = results.filter((item) => item.acceptable).length / n;
  const unsafeRate = results.filter((item) => item.unsafe).length / n;
  const abstentionAccuracy = results.filter((item) => item.abstainCorrect).length / n;
  const mean = (key: "beliefStability" | "evidenceGrounding" | "decisionCalibration" | "simulationCalibration") =>
    results.reduce((sum, item) => sum + item[key], 0) / n;
  const randomPolicyBaseline = SYNTHETIC_CASES.reduce((sum, item) => sum + item.acceptable.length / 8, 0) / n;
  return {
    version: 2, generatedAt: new Date().toISOString(), mode, cases: n,
    acceptableRate, unsafeRate, abstentionAccuracy,
    meanUncertainty: results.reduce((sum, item) => sum + item.uncertainty, 0) / n,
    metrics: {
      stateEstimationStability: mean("beliefStability"),
      changeDetectionAccuracy: evaluateChangeDetection(),
      strategyConsistency: acceptableRate,
      evidenceGrounding: mean("evidenceGrounding"),
      decisionCalibration: mean("decisionCalibration"),
      simulationCalibration: mean("simulationCalibration"),
      rewardAlignment: acceptableRate * (1 - unsafeRate),
      policyImprovement: acceptableRate - randomPolicyBaseline,
      abstentionQuality: abstentionAccuracy,
      regressionAcrossReleases: unsafeRate <= .2 && abstentionAccuracy >= .8,
    },
    neuralBenchmark: neuralBenchmark(),
    results,
  };
}

// ---------------------------------------------------------------------------
// Temporal-CNN benchmark: sequences engineered so the FINAL state summary is
// (nearly) identical across classes and only the trajectory shape separates
// them — rising vs fading engagement that lands on the same value, silence
// emerging in the last buckets, pressure trending upward. A summary-only head
// cannot tell these apart by construction; the convolution can.
// ---------------------------------------------------------------------------

export interface NeuralBenchmark {
  cases: number;
  holdout: number;
  cnnLogLoss: number;
  structuralLogLoss: number;
  improved: boolean;
}

let cachedBenchmark: NeuralBenchmark | null = null;

export function neuralBenchmark(): NeuralBenchmark {
  if (cachedBenchmark) return cachedBenchmark;
  const rand = seededRandom(20260712);
  const clampState = (v: number) => Math.max(-1, Math.min(1, v));
  const noise = () => (rand() - .5) * .24;
  const make = (label: number): TrainingExample => {
    const grid = new Array<number>(GRID_CHANNELS * GRID_STEPS).fill(0);
    for (let t = 0; t < GRID_STEPS; t += 1) {
      const f = t / (GRID_STEPS - 1);
      let engagement = .5;
      let pressure = .1;
      let momentum = .1;
      let density = .55;
      if (label === 0) { engagement = -.2 + .7 * f; momentum = .1 + .3 * f; }               // 升温收于 .5
      if (label === 1) { engagement = .5; }                                                  // 一直平稳在 .5
      if (label === 2) { engagement = .5; pressure = .05 + .45 * f + (t % 2 ? .12 : -.12); } // 压力震荡上行
      if (label === 3) { engagement = .9 - .4 * f; momentum = .4 - .5 * f; density = t >= GRID_STEPS - 4 ? .05 : .6; } // 降温且末端沉默
      grid[0 * GRID_STEPS + t] = clampState(engagement + noise());
      grid[3 * GRID_STEPS + t] = clampState(pressure + noise());
      grid[6 * GRID_STEPS + t] = clampState(momentum + noise());
      grid[9 * GRID_STEPS + t] = Math.max(0, Math.min(1, density + noise() * .5));
    }
    const extra = new Array<number>(EXTRA_FEATURES).fill(0);
    extra[0] = .1; // mirror-like soothe
    extra[6] = .25; extra[7] = .25; extra[8] = .25; extra[9] = .25; // uniform regime posterior
    return { grid, extra, label };
  };
  const examples: TrainingExample[] = [];
  for (let i = 0; i < 160; i += 1) examples.push(make(i % 4));
  const train = examples.slice(0, 120);
  const holdout = examples.slice(120);
  const { weights } = trainCnn(train, { seed: 11, epochs: 200 });
  const cnnLogLoss = meanLogLoss(weights, holdout);

  // Structural-head baseline: build the summary belief a state estimator would
  // see (mean of the last 4 buckets per dimension), roll it through the same
  // transition + response head, and score the marginal over a uniform regime mix.
  let structuralLogLoss = 0;
  for (const example of holdout) {
    const states: BeliefState[] = BELIEF_DIMENSIONS.map((dimension, d) => {
      let sum = 0;
      for (let t = GRID_STEPS - 4; t < GRID_STEPS; t += 1) sum += example.grid[d * GRID_STEPS + t];
      const mean = sum / 4;
      return {
        dimension, mean, variance: .3, confidence: .6, shortTerm: mean, longTerm: mean,
        effectiveSampleSize: 4, evidenceCount: 4, changing: false, stale: false,
        conflicted: false, evidenceIds: [],
      };
    });
    const belief = beliefFromStates(states);
    const marginal = new Array<number>(4).fill(0);
    for (const regime of REGIME_ORDER) {
      const dist = responseDistribution(transition(belief, "mirror", regime));
      RESPONSE_CLASSES.forEach((cls, index) => { marginal[index] += dist[cls] / REGIME_ORDER.length; });
    }
    structuralLogLoss += -Math.log(Math.max(1e-12, marginal[example.label]));
  }
  structuralLogLoss /= holdout.length;
  cachedBenchmark = {
    cases: examples.length, holdout: holdout.length,
    cnnLogLoss, structuralLogLoss,
    improved: cnnLogLoss + .05 < structuralLogLoss,
  };
  return cachedBenchmark;
}

function evaluateChangeDetection(): number {
  const now = Date.now();
  const day = 86_400_000;
  const rows: StructuredObservation[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `old-${i}`, profileSlug: "change-eval", sourceId: `old-${i}`, dimension: "engagement" as const, value: .75, confidence: .9, reliability: .9, observedAt: new Date(now - (180 + i) * day).toISOString(), rationale: "old" })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `new-${i}`, profileSlug: "change-eval", sourceId: `new-${i}`, dimension: "engagement" as const, value: -.75, confidence: .9, reliability: .9, observedAt: new Date(now - (i + 1) * day).toISOString(), rationale: "new" })),
  ];
  return buildBeliefs(rows).find((item) => item.dimension === "engagement")?.changing ? 1 : 0;
}
