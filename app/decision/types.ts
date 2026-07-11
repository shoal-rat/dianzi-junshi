import type { FeedbackOutcome } from "../adaptive";

export type PlanningMode = "fast" | "balanced" | "deep";
export type EvidenceKind = "message" | "material" | "outcome" | "fact" | "observation";

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
  | "clarify" | "give_space" | "boundary" | "seek_more_context";

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
  mode: "reply" | "analyze" | "ask" | "interest";
  planningMode: PlanningMode;
  text: string;
  evidence: EvidenceRef[];
}
