import type { FeedbackOutcome } from "../adaptive";

export type PlanningMode = "fast" | "balanced" | "deep";
export type EvidenceKind = "message" | "material" | "outcome" | "fact" | "observation";

/** Partner-response classes are exactly the recordable real outcomes, so the
 * world model's predictive distribution is directly scoreable against feedback. */
export type ResponseClass = FeedbackOutcome;

/** Learned per-(regime, family) statistics: decayed Dirichlet response counts
 * and mean transition residuals on the outcome-observable dimensions. */
export interface LearnedRegimeFamily {
  counts: Partial<Record<ResponseClass, number>>;
  effective: number;
  delta: Partial<Record<BeliefDimension, number>>;
}

export interface WorldModelSnapshot {
  entries: Record<string, LearnedRegimeFamily>;
  gate: { logLossModel: number; logLossBase: number; samples: number };
}

/** Per-profile clocks derived from the interaction tempo: canonical half-lives
 * (21/240/120 days) scaled by the median gap between this person's exchanges. */
export interface ProfileTimescales {
  shortDays: number;
  longDays: number;
  learningDays: number;
  tempo: number;
  medianGapDays: number;
}

/** One node of the decision network trace: an actual quantity the engine
 * computed this round, with its activation and inspectable parameters. */
export interface TraceNode {
  id: string;
  label: string;
  /** Signed activation in [-1, 1] (state-like) or [0, 1] (probability-like). */
  activation: number;
  /** Parameter lines shown when the node is inspected in the UI. */
  detail: string[];
}

export interface TraceEdge {
  from: string;
  to: string;
  /** Signed contribution weight, normalized to [-1, 1] for rendering. */
  weight: number;
}

/** Layered dataflow of one decision: beliefs → regimes → action features →
 * predicted state → response classes → outputs. Every value is read from the
 * actual computation, so the visualization is an audit view, not decoration. */
export interface NetworkTrace {
  layers: Array<{ id: string; label: string; nodes: TraceNode[] }>;
  edges: TraceEdge[];
}

export const BELIEF_DIMENSIONS = [
  "engagement", "trust", "communication_willingness", "emotional_pressure",
  "boundary_sensitivity", "commitment_reliability", "momentum", "initiative", "consistency",
] as const;
export type BeliefDimension = typeof BELIEF_DIMENSIONS[number];

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  text: string;
  observedAt: string;
  reliability: number;
  importance: number;
  relevance?: number;
  contradiction?: boolean;
  sourceId?: string;
}

export interface StructuredObservation {
  id: string;
  profileSlug: string;
  sourceId: string;
  dimension: BeliefDimension;
  value: number;
  confidence: number;
  reliability: number;
  observedAt: string;
  rationale: string;
}

export interface BeliefState {
  dimension: BeliefDimension;
  mean: number;
  variance: number;
  confidence: number;
  shortTerm: number;
  longTerm: number;
  effectiveSampleSize: number;
  evidenceCount: number;
  changing: boolean;
  stale: boolean;
  conflicted: boolean;
  evidenceIds: string[];
}

export interface StateHypothesis {
  id: string;
  label: string;
  probability: number;
  explanation: string;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
}

export interface ChangeSignal {
  dimension: BeliefDimension;
  magnitude: number;
  confidence: number;
  direction: "up" | "down";
  explanation: string;
}

export interface PatternSignal {
  id: string;
  label: string;
  support: number;
  counterexamples: number;
  confidence: number;
  validated: boolean;
  explanation: string;
  lifecycle?: "candidate" | "active" | "watch" | "retired" | "rejected";
  firstSeenAt?: string;
  lastSeenAt?: string;
}

export type StrategyFamily =
  | "mirror" | "warm" | "playful" | "direct" | "invite"
  | "clarify" | "give_space" | "seek_more_context";

export interface StrategyCandidate {
  id: string;
  family: StrategyFamily;
  label: string;
  intent: string;
  tactic: string;
  tone: string;
  risk: string;
  informationGain: number;
  prior: number;
  explorationBonus: number;
  score: number;
}

export interface SimulationBranch {
  id: string;
  strategyId: string;
  outcome: string;
  probability: number;
  immediateReward: number;
  delayedReward: number;
  risk: number;
  hypothesisId: string;
  /** Predictive distribution over partner-response classes for this branch. */
  responseDistribution?: Record<ResponseClass, number>;
  /** Posterior-mean state the world model predicts after this action. */
  predictedState?: Partial<Record<BeliefDimension, number>>;
  /** Variance of the normalized rollout value across imagined responses. */
  valueVariance?: number;
  /** Rollout depth (exchanges) used for the value estimate. */
  horizon?: number;
}

export interface CriticScore {
  strategyId: string;
  goalAlignment: number;
  evidenceUse: number;
  consistency: number;
  naturalness: number;
  informationValue: number;
  risk: number;
  notes: string[];
}

export interface UncertaintyReport {
  total: number;
  stateEntropy: number;
  evidenceConflict: number;
  simulationVariance: number;
  scoreMargin: number;
  evidenceCoverage: number;
  abstain: boolean;
  reason?: string;
}

export interface DecisionMetrics {
  startedAt: string;
  durationMs: number;
  stageMs: Record<string, number>;
  llmCalls: number;
  cacheHits: number;
  evidenceScanned: number;
  evidenceSelected: number;
  simulationCount: number;
  planningMode: PlanningMode;
}

export interface DecisionReport {
  id: string;
  profileSlug: string;
  createdAt: string;
  planningMode: PlanningMode;
  goal: string;
  observations: StructuredObservation[];
  beliefs: BeliefState[];
  hypotheses: StateHypothesis[];
  changes: ChangeSignal[];
  patterns: PatternSignal[];
  missingInformation: string[];
  evidence: EvidenceRef[];
  strategies: StrategyCandidate[];
  simulations: SimulationBranch[];
  critics: CriticScore[];
  uncertainty: UncertaintyReport;
  selectedStrategy: StrategyCandidate;
  selectionReason: string;
  replyId: string;
  metrics: DecisionMetrics;
  networkTrace?: NetworkTrace;
  timescales?: ProfileTimescales;
}

export interface DecisionEvent {
  id: string;
  profileSlug: string;
  type: string;
  payload: Record<string, unknown>;
  observedAt: string;
  createdAt: string;
  causationId?: string;
}

export interface LinkedOutcome {
  decisionId?: string;
  strategyId?: string;
  replyId?: string;
  replyText: string;
  partnerResponse?: string;
  outcome: FeedbackOutcome;
  responseDelayHours?: number;
  signals?: Record<string, boolean | undefined>;
  observedAt?: string;
}

export interface PipelineInput {
  profileSlug: string;
  partnerName: string;
  stage: number;
  antiSimp: boolean;
  /** Risk appetite in [0,1]: 0 = cautious, 1 = bold. Scales the risk penalty,
   * advance bonuses, clarifying-question cost and the abstention bar. */
  boldness?: number;
  mode: "reply" | "analyze" | "ask" | "interest";
  planningMode: PlanningMode;
  text: string;
  /** Screenshots sent this round: the engine reads them (vision structured
   * call) so an image-only message still produces grounded observations. */
  images?: Array<{ mediaType: string; dataBase64: string }>;
  localImagePaths?: string[];
  evidence: EvidenceRef[];
}
