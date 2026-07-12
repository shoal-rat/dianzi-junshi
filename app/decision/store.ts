import type { Database } from "bun:sqlite";
import { decisionDatabase } from "../adaptive";
import type {
  BeliefState, CriticScore, DecisionEvent, DecisionReport, EvidenceRef, LinkedOutcome,
  PatternSignal, SimulationBranch, StateHypothesis, StrategyCandidate, StructuredObservation,
  BeliefDimension, LearnedRegimeFamily, ResponseClass, WorldModelSnapshot,
} from "./types";
import { RESPONSE_CLASSES, actionFeatureVector, regimePosteriorVector } from "./worldmodel";
import {
  buildObservationGrid, meanLogLoss, parameterCount, trainCnn,
  type CnnWeights, type TrainingExample,
} from "./neural";

let migrated = false;

function db(): Database {
  const conn = decisionDatabase();
  if (!migrated) {
    migrateDecisionStore(conn);
    migrated = true;
  }
  return conn;
}

function migrateDecisionStore(conn: Database): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS decision_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      profile_slug TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      causation_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decision_events_profile_time
      ON decision_events(profile_slug, observed_at, sequence);
    CREATE INDEX IF NOT EXISTS idx_decision_events_type
      ON decision_events(profile_slug, event_type, observed_at DESC);

    CREATE TABLE IF NOT EXISTS structured_observations (
      id TEXT PRIMARY KEY, profile_slug TEXT NOT NULL, source_id TEXT NOT NULL,
      dimension TEXT NOT NULL, value REAL NOT NULL, confidence REAL NOT NULL,
      reliability REAL NOT NULL, observed_at TEXT NOT NULL, rationale TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_observation_dimension_time
      ON structured_observations(profile_slug, dimension, observed_at DESC);

    CREATE TABLE IF NOT EXISTS temporal_facts (
      id TEXT PRIMARY KEY, profile_slug TEXT NOT NULL, subject TEXT NOT NULL,
      predicate TEXT NOT NULL, object TEXT NOT NULL, valid_from TEXT NOT NULL,
      valid_to TEXT, confidence REAL NOT NULL, reliability REAL NOT NULL,
      source_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_temporal_facts_profile
      ON temporal_facts(profile_slug, predicate, valid_from DESC);

    CREATE TABLE IF NOT EXISTS decision_runs (
      id TEXT PRIMARY KEY, profile_slug TEXT NOT NULL, planning_mode TEXT NOT NULL,
      goal TEXT NOT NULL, selected_strategy_id TEXT NOT NULL, reply_id TEXT NOT NULL,
      report_json TEXT NOT NULL, created_at TEXT NOT NULL, duration_ms REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decision_runs_profile_time
      ON decision_runs(profile_slug, created_at DESC);

    CREATE TABLE IF NOT EXISTS outcome_events (
      id TEXT PRIMARY KEY, profile_slug TEXT NOT NULL, decision_id TEXT,
      strategy_id TEXT, reply_id TEXT, reply_text TEXT NOT NULL,
      partner_response TEXT NOT NULL, outcome TEXT NOT NULL,
      response_delay_hours REAL, signals_json TEXT NOT NULL,
      observed_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outcomes_profile_time
      ON outcome_events(profile_slug, observed_at DESC);

    CREATE TABLE IF NOT EXISTS strategy_posteriors (
      profile_slug TEXT NOT NULL, context_key TEXT NOT NULL, strategy_family TEXT NOT NULL,
      alpha REAL NOT NULL, beta REAL NOT NULL, effective_samples REAL NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(profile_slug, context_key, strategy_family)
    );

    CREATE TABLE IF NOT EXISTS evidence_usefulness (
      profile_slug TEXT NOT NULL, evidence_id TEXT NOT NULL,
      useful REAL NOT NULL, harmful REAL NOT NULL, uses REAL NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(profile_slug, evidence_id)
    );

    CREATE TABLE IF NOT EXISTS decision_cache (
      cache_key TEXT PRIMARY KEY, value_json TEXT NOT NULL,
      provider TEXT NOT NULL, schema_name TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decision_cache_expiry ON decision_cache(expires_at);

    CREATE TABLE IF NOT EXISTS stage_metrics (
      id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, profile_slug TEXT NOT NULL,
      stage TEXT NOT NULL, duration_ms REAL NOT NULL, details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_nodes (
      id TEXT NOT NULL, profile_slug TEXT NOT NULL, node_type TEXT NOT NULL,
      label TEXT NOT NULL, attributes_json TEXT NOT NULL, observed_at TEXT NOT NULL,
      reliability REAL NOT NULL, source_id TEXT, status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY(profile_slug, id)
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_nodes_profile_time
      ON evidence_nodes(profile_slug, observed_at DESC);
    CREATE TABLE IF NOT EXISTS evidence_edges (
      id TEXT PRIMARY KEY, profile_slug TEXT NOT NULL, from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL, relation TEXT NOT NULL, weight REAL NOT NULL,
      confidence REAL NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT,
      source_id TEXT, status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_edges_neighborhood
      ON evidence_edges(profile_slug, from_node_id, to_node_id, relation);
    CREATE TABLE IF NOT EXISTS pattern_registry (
      profile_slug TEXT NOT NULL, pattern_id TEXT NOT NULL, label TEXT NOT NULL,
      lifecycle TEXT NOT NULL, support REAL NOT NULL, counterexamples REAL NOT NULL,
      confidence REAL NOT NULL, explanation TEXT NOT NULL, first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL, version INTEGER NOT NULL, metadata_json TEXT NOT NULL,
      PRIMARY KEY(profile_slug, pattern_id)
    );
    CREATE INDEX IF NOT EXISTS idx_patterns_profile_lifecycle
      ON pattern_registry(profile_slug, lifecycle, confidence DESC);
    CREATE TABLE IF NOT EXISTS calibration_examples (
      id TEXT PRIMARY KEY, consent_version TEXT NOT NULL, captured_at TEXT NOT NULL,
      features_json TEXT NOT NULL, prediction_json TEXT NOT NULL,
      outcome_json TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calibration_active_time
      ON calibration_examples(deleted_at, captured_at DESC);
    CREATE TABLE IF NOT EXISTS world_model_stats (
      profile_slug TEXT NOT NULL, regime TEXT NOT NULL, strategy_family TEXT NOT NULL,
      counts_json TEXT NOT NULL, delta_json TEXT NOT NULL, effective REAL NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(profile_slug, regime, strategy_family)
    );
    CREATE TABLE IF NOT EXISTS world_model_gate (
      profile_slug TEXT PRIMARY KEY, log_loss_model REAL NOT NULL,
      log_loss_base REAL NOT NULL, samples REAL NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS neural_predictor (
      scope TEXT PRIMARY KEY, weights_json TEXT NOT NULL, samples INTEGER NOT NULL,
      params INTEGER NOT NULL, holdout_model REAL, holdout_base REAL, trained_at TEXT NOT NULL
    );
  `);
  for (const version of [2, 3, 4, 5]) {
    conn.query("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(version, new Date().toISOString());
  }
  bootstrapLegacyOutcomes(conn);
}

function bootstrapLegacyOutcomes(conn: Database): void {
  const rows = conn.query(`SELECT id, profile_slug, reply_text, partner_response, outcome,
    response_delay_hours, signals_json, strategy_keys_json, observed_at, created_at
    FROM feedback_events WHERE id NOT IN (SELECT id FROM outcome_events)`).all() as any[];
  const insert = conn.query(`INSERT OR IGNORE INTO outcome_events(
    id, profile_slug, reply_text, partner_response, outcome, response_delay_hours,
    signals_json, observed_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const event = conn.query(`INSERT OR IGNORE INTO decision_events(
    id, profile_slug, event_type, payload_json, observed_at, created_at
  ) VALUES (?, ?, 'outcome.recorded', ?, ?, ?)`);
  const transaction = conn.transaction(() => {
    for (const row of rows) {
      insert.run(row.id, row.profile_slug, row.reply_text, row.partner_response, row.outcome,
        row.response_delay_hours, row.signals_json, row.observed_at, row.created_at);
      event.run(`legacy-${row.id}`, row.profile_slug, JSON.stringify({
        outcomeId: row.id, outcome: row.outcome, strategyKeys: parseJson(row.strategy_keys_json, []), legacy: true,
      }), row.observed_at, row.created_at);
    }
  });
  transaction();
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

export function appendDecisionEvent(
  profileSlug: string,
  type: string,
  payload: Record<string, unknown>,
  options: { id?: string; observedAt?: string; causationId?: string } = {},
): DecisionEvent {
  const now = new Date().toISOString();
  const event: DecisionEvent = {
    id: options.id ?? crypto.randomUUID(), profileSlug, type, payload,
    observedAt: options.observedAt ?? now, createdAt: now, causationId: options.causationId,
  };
  db().query(`INSERT INTO decision_events(
    id, profile_slug, event_type, payload_json, observed_at, created_at, causation_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    event.id, event.profileSlug, event.type, JSON.stringify(event.payload), event.observedAt,
    event.createdAt, event.causationId ?? null,
  );
  return event;
}

export function readDecisionEvents(profileSlug: string, limit = 10_000): DecisionEvent[] {
  const rows = db().query(`SELECT id, profile_slug, event_type, payload_json, observed_at, created_at, causation_id
    FROM decision_events WHERE profile_slug=? ORDER BY observed_at, sequence LIMIT ?`).all(profileSlug, limit) as any[];
  return rows.map((row) => ({
    id: String(row.id), profileSlug: String(row.profile_slug), type: String(row.event_type),
    payload: parseJson(row.payload_json, {}), observedAt: String(row.observed_at),
    createdAt: String(row.created_at), causationId: row.causation_id ? String(row.causation_id) : undefined,
  }));
}

export function saveObservations(observations: StructuredObservation[]): void {
  if (!observations.length) return;
  const conn = db();
  const insert = conn.query(`INSERT OR IGNORE INTO structured_observations(
    id, profile_slug, source_id, dimension, value, confidence, reliability, observed_at, rationale
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  conn.transaction(() => {
    for (const item of observations) {
      insert.run(
        item.id, item.profileSlug, item.sourceId, item.dimension, item.value, item.confidence,
        item.reliability, item.observedAt, item.rationale,
      );
      upsertEvidenceNode({
        id: item.id, profileSlug: item.profileSlug, nodeType: "observation",
        label: `${item.dimension}: ${item.rationale}`, observedAt: item.observedAt,
        reliability: item.reliability * item.confidence, sourceId: item.sourceId,
        attributes: { dimension: item.dimension, value: item.value, confidence: item.confidence },
      });
      upsertEvidenceEdge({
        profileSlug: item.profileSlug, fromNodeId: item.id, toNodeId: item.sourceId,
        relation: "derived_from", weight: item.value, confidence: item.confidence,
        validFrom: item.observedAt, sourceId: item.sourceId,
      });
    }
  })();
}

export function readObservations(profileSlug: string, limit = 1200): StructuredObservation[] {
  const rows = db().query(`SELECT * FROM structured_observations
    WHERE profile_slug=? ORDER BY observed_at DESC LIMIT ?`).all(profileSlug, limit) as any[];
  return rows.map((r) => ({
    id: r.id, profileSlug: r.profile_slug, sourceId: r.source_id, dimension: r.dimension,
    value: Number(r.value), confidence: Number(r.confidence), reliability: Number(r.reliability),
    observedAt: r.observed_at, rationale: r.rationale,
  }));
}

export type EvidenceRelation =
  | "derived_from" | "supports" | "contradicts" | "precedes" | "supersedes"
  | "used_by" | "selected" | "produced" | "outcome_of" | "correlates_with";

export interface EvidenceNode {
  id: string; profileSlug: string; nodeType: string; label: string;
  attributes: Record<string, unknown>; observedAt: string; reliability: number;
  sourceId?: string; status?: "active" | "superseded" | "disputed" | "retired";
}

export interface EvidenceEdge {
  id?: string; profileSlug: string; fromNodeId: string; toNodeId: string;
  relation: EvidenceRelation; weight: number; confidence: number; validFrom: string;
  validTo?: string; sourceId?: string; status?: "active" | "retired";
}

export function upsertEvidenceNode(node: EvidenceNode): void {
  db().query(`INSERT INTO evidence_nodes(
    id, profile_slug, node_type, label, attributes_json, observed_at,
    reliability, source_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(profile_slug, id) DO UPDATE SET label=excluded.label,
    attributes_json=excluded.attributes_json, observed_at=excluded.observed_at,
    reliability=excluded.reliability, status=excluded.status`).run(
      node.id, node.profileSlug, node.nodeType, node.label.slice(0, 1000),
      JSON.stringify(node.attributes), node.observedAt, Math.max(0, Math.min(1, node.reliability)),
      node.sourceId ?? null, node.status ?? "active",
    );
}

export function upsertEvidenceEdge(edge: EvidenceEdge): string {
  const id = edge.id ?? `${edge.profileSlug}:${edge.fromNodeId}:${edge.relation}:${edge.toNodeId}`;
  db().query(`INSERT INTO evidence_edges(
    id, profile_slug, from_node_id, to_node_id, relation, weight, confidence,
    valid_from, valid_to, source_id, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET weight=excluded.weight, confidence=excluded.confidence,
    valid_from=excluded.valid_from, valid_to=excluded.valid_to, status=excluded.status`).run(
      id, edge.profileSlug, edge.fromNodeId, edge.toNodeId, edge.relation,
      edge.weight, Math.max(0, Math.min(1, edge.confidence)), edge.validFrom,
      edge.validTo ?? null, edge.sourceId ?? null, edge.status ?? "active",
    );
  return id;
}

export function graphEvidence(profileSlug: string, limit = 80): EvidenceRef[] {
  const rows = db().query(`SELECT n.id, n.node_type, n.label, n.observed_at, n.reliability,
      COUNT(e.id) AS edge_count,
      SUM(CASE WHEN e.relation='contradicts' THEN 1 ELSE 0 END) AS contradictions
    FROM evidence_nodes n LEFT JOIN evidence_edges e
      ON e.profile_slug=n.profile_slug AND (e.from_node_id=n.id OR e.to_node_id=n.id)
      AND e.status='active'
    WHERE n.profile_slug=? AND n.status IN ('active','disputed')
    GROUP BY n.profile_slug, n.id ORDER BY n.observed_at DESC LIMIT ?`).all(profileSlug, limit) as any[];
  return rows.map((row) => ({
    id: `graph:${row.id}`, kind: row.node_type === "fact" ? "fact" as const : "observation" as const,
    text: String(row.label), observedAt: String(row.observed_at),
    reliability: Number(row.reliability), importance: Math.min(1, .35 + Number(row.edge_count ?? 0) * .08),
    contradiction: Number(row.contradictions ?? 0) > 0, sourceId: String(row.id),
  }));
}

export function evidenceGraph(profileSlug: string, limit = 240) {
  const nodes = db().query(`SELECT id, node_type, label, attributes_json, observed_at,
    reliability, source_id, status FROM evidence_nodes WHERE profile_slug=?
    ORDER BY observed_at DESC LIMIT ?`).all(profileSlug, limit) as any[];
  const ids = new Set(nodes.map((row) => String(row.id)));
  const edges = db().query(`SELECT id, from_node_id, to_node_id, relation, weight,
    confidence, valid_from, valid_to, source_id, status FROM evidence_edges
    WHERE profile_slug=? ORDER BY valid_from DESC LIMIT ?`).all(profileSlug, limit * 3) as any[];
  return {
    nodes: nodes.map((row) => ({ ...row, attributes: parseJson(row.attributes_json, {}) })),
    edges: edges.filter((row) => ids.has(String(row.from_node_id)) || ids.has(String(row.to_node_id))),
  };
}

export interface TemporalFact {
  id: string; profileSlug: string; subject: string; predicate: string; object: string;
  validFrom: string; validTo?: string; confidence: number; reliability: number;
  sourceId: string; status: "active" | "superseded" | "disputed";
}

/** Facts keep validity intervals and conflicting claims. A new value closes the
 * previous interval only when both claims are reliable; otherwise both remain disputed. */
export function recordTemporalFact(fact: Omit<TemporalFact, "id" | "status">): TemporalFact {
  const conn = db();
  const id = crypto.randomUUID();
  let status: TemporalFact["status"] = "active";
  conn.transaction(() => {
    const previous = conn.query(`SELECT id, object, confidence, reliability FROM temporal_facts
      WHERE profile_slug=? AND subject=? AND predicate=? AND valid_to IS NULL AND status='active'
      ORDER BY valid_from DESC LIMIT 1`).get(fact.profileSlug, fact.subject, fact.predicate) as any;
    if (previous && String(previous.object) !== fact.object) {
      if (Number(previous.confidence) * Number(previous.reliability) >= .48 && fact.confidence * fact.reliability >= .48) {
        status = "disputed";
        conn.query("UPDATE temporal_facts SET status='disputed' WHERE id=?").run(previous.id);
        upsertEvidenceEdge({
          profileSlug: fact.profileSlug, fromNodeId: id, toNodeId: String(previous.id),
          relation: "contradicts", weight: -1, confidence: Math.min(fact.confidence, Number(previous.confidence)),
          validFrom: fact.validFrom, sourceId: fact.sourceId,
        });
      } else if (fact.confidence * fact.reliability > Number(previous.confidence) * Number(previous.reliability)) {
        conn.query("UPDATE temporal_facts SET status='superseded', valid_to=? WHERE id=?").run(fact.validFrom, previous.id);
        upsertEvidenceEdge({
          profileSlug: fact.profileSlug, fromNodeId: id, toNodeId: String(previous.id),
          relation: "supersedes", weight: 1, confidence: fact.confidence,
          validFrom: fact.validFrom, sourceId: fact.sourceId,
        });
      }
    }
    conn.query(`INSERT INTO temporal_facts(
      id, profile_slug, subject, predicate, object, valid_from, valid_to,
      confidence, reliability, source_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, fact.profileSlug, fact.subject, fact.predicate, fact.object, fact.validFrom,
      fact.validTo ?? null, fact.confidence, fact.reliability, fact.sourceId, status,
    );
    upsertEvidenceNode({
      id, profileSlug: fact.profileSlug, nodeType: "fact",
      label: `${fact.subject} · ${fact.predicate} · ${fact.object}`, attributes: {
        subject: fact.subject, predicate: fact.predicate, object: fact.object,
        confidence: fact.confidence,
      }, observedAt: fact.validFrom, reliability: fact.reliability,
      sourceId: fact.sourceId, status: status === "disputed" ? "disputed" : "active",
    });
    upsertEvidenceEdge({
      profileSlug: fact.profileSlug, fromNodeId: id, toNodeId: fact.sourceId,
      relation: "derived_from", weight: 1, confidence: fact.confidence,
      validFrom: fact.validFrom, sourceId: fact.sourceId,
    });
    appendDecisionEvent(fact.profileSlug, "fact.recorded", {
      factId: id, subject: fact.subject, predicate: fact.predicate, object: fact.object,
      confidence: fact.confidence, reliability: fact.reliability, status,
    }, { observedAt: fact.validFrom, causationId: fact.sourceId });
  })();
  return { ...fact, id, status };
}

export function readTemporalFacts(profileSlug: string, at = new Date().toISOString()): TemporalFact[] {
  const rows = db().query(`SELECT * FROM temporal_facts WHERE profile_slug=?
    AND valid_from<=? AND (valid_to IS NULL OR valid_to>?) ORDER BY valid_from DESC`).all(profileSlug, at, at) as any[];
  return rows.map((row) => ({
    id: row.id, profileSlug: row.profile_slug, subject: row.subject, predicate: row.predicate,
    object: row.object, validFrom: row.valid_from, validTo: row.valid_to ?? undefined,
    confidence: Number(row.confidence), reliability: Number(row.reliability),
    sourceId: row.source_id, status: row.status,
  }));
}

export function saveDecisionReport(report: DecisionReport): void {
  const conn = db();
  conn.transaction(() => {
    conn.query(`INSERT INTO decision_runs(
      id, profile_slug, planning_mode, goal, selected_strategy_id, reply_id, report_json, created_at, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      report.id, report.profileSlug, report.planningMode, report.goal, report.selectedStrategy.id,
      report.replyId, JSON.stringify(report), report.createdAt, report.metrics.durationMs,
    );
    const metric = conn.query(`INSERT INTO stage_metrics(
      id, decision_id, profile_slug, stage, duration_ms, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const [stage, duration] of Object.entries(report.metrics.stageMs)) {
      metric.run(crypto.randomUUID(), report.id, report.profileSlug, stage, duration, "{}", report.createdAt);
    }
    upsertEvidenceNode({
      id: report.id, profileSlug: report.profileSlug, nodeType: "decision",
      label: `${report.goal} → ${report.selectedStrategy.label}`,
      attributes: { planningMode: report.planningMode, uncertainty: report.uncertainty.total },
      observedAt: report.createdAt, reliability: 1,
    });
    upsertEvidenceNode({
      id: report.selectedStrategy.id, profileSlug: report.profileSlug, nodeType: "strategy",
      label: report.selectedStrategy.label,
      attributes: { family: report.selectedStrategy.family, score: report.selectedStrategy.score },
      observedAt: report.createdAt, reliability: Math.max(.2, 1 - report.uncertainty.total), sourceId: report.id,
    });
    upsertEvidenceEdge({
      profileSlug: report.profileSlug, fromNodeId: report.id, toNodeId: report.selectedStrategy.id,
      relation: "selected", weight: report.selectedStrategy.score,
      confidence: 1 - report.uncertainty.total, validFrom: report.createdAt, sourceId: report.id,
    });
    for (const evidence of report.evidence) upsertEvidenceEdge({
      profileSlug: report.profileSlug, fromNodeId: evidence.sourceId ?? evidence.id,
      toNodeId: report.id, relation: evidence.contradiction ? "contradicts" : "used_by",
      weight: evidence.relevance ?? .5, confidence: evidence.reliability,
      validFrom: report.createdAt, sourceId: report.id,
    });
    appendDecisionEvent(report.profileSlug, "decision.completed", {
      decisionId: report.id, strategyId: report.selectedStrategy.id,
      strategyFamily: report.selectedStrategy.family, replyId: report.replyId,
      uncertainty: report.uncertainty.total, evidenceIds: report.evidence.map((e) => e.id),
    }, { causationId: report.id });
  })();
}

export function getDecisionReport(profileSlug: string, id?: string): DecisionReport | null {
  const row = id
    ? db().query("SELECT report_json FROM decision_runs WHERE profile_slug=? AND id=?").get(profileSlug, id) as any
    : db().query("SELECT report_json FROM decision_runs WHERE profile_slug=? ORDER BY created_at DESC LIMIT 1").get(profileSlug) as any;
  return row ? parseJson<DecisionReport>(row.report_json, null as unknown as DecisionReport) : null;
}

export function listDecisionReports(profileSlug: string, limit = 20): DecisionReport[] {
  const rows = db().query(`SELECT report_json FROM decision_runs
    WHERE profile_slug=? ORDER BY created_at DESC LIMIT ?`).all(profileSlug, Math.min(100, Math.max(1, limit))) as any[];
  return rows.map((r) => parseJson<DecisionReport>(r.report_json, null as unknown as DecisionReport)).filter(Boolean);
}

export function recordLinkedOutcome(profileSlug: string, input: LinkedOutcome): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const observedAt = input.observedAt && !Number.isNaN(Date.parse(input.observedAt))
    ? new Date(input.observedAt).toISOString() : now;
  const decision = input.decisionId ? getDecisionReport(profileSlug, input.decisionId) : null;
  const strategyFamily = decision?.strategies.find((s) => s.id === input.strategyId)?.family
    ?? decision?.selectedStrategy.family;
  const conn = db();
  conn.transaction(() => {
    conn.query(`INSERT INTO outcome_events(
      id, profile_slug, decision_id, strategy_id, reply_id, reply_text, partner_response,
      outcome, response_delay_hours, signals_json, observed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, profileSlug, input.decisionId ?? null, input.strategyId ?? null, input.replyId ?? null,
      input.replyText.trim().slice(0, 2000), String(input.partnerResponse ?? "").slice(0, 4000),
      input.outcome, input.responseDelayHours ?? null, JSON.stringify(input.signals ?? {}), observedAt, now,
    );
    upsertEvidenceNode({
      id, profileSlug, nodeType: "outcome", label: `真实结果：${input.outcome}`,
      attributes: { outcome: input.outcome, responseDelayHours: input.responseDelayHours,
        signals: input.signals ?? {} }, observedAt, reliability: .95,
      sourceId: input.decisionId,
    });
    if (input.decisionId) upsertEvidenceEdge({
      profileSlug, fromNodeId: id, toNodeId: input.decisionId,
      relation: "outcome_of", weight: outcomeValue(input.outcome), confidence: .95,
      validFrom: observedAt, sourceId: id,
    });
    if (input.strategyId) upsertEvidenceEdge({
      profileSlug, fromNodeId: input.strategyId, toNodeId: id,
      relation: "produced", weight: outcomeValue(input.outcome), confidence: .85,
      validFrom: observedAt, sourceId: id,
    });
    appendDecisionEvent(profileSlug, "outcome.recorded", {
      outcomeId: id, decisionId: input.decisionId, strategyId: input.strategyId,
      strategyFamily, outcome: input.outcome, responseDelayHours: input.responseDelayHours,
    }, { observedAt, causationId: input.decisionId });
    const outcomeObservations = observationsFromOutcome(profileSlug, id, input, observedAt);
    saveObservations(outcomeObservations);
    for (const observation of outcomeObservations) appendDecisionEvent(profileSlug, "observation.extracted", {
      observationId: observation.id, sourceId: observation.sourceId, dimension: observation.dimension,
      value: observation.value, confidence: observation.confidence, reliability: observation.reliability,
      rationale: observation.rationale,
    }, { observedAt, causationId: id });
    if (strategyFamily) updatePosterior(profileSlug, contextKey(decision), strategyFamily, input.outcome, observedAt, decision?.timescales?.learningDays ?? 120);
    if (decision) {
      updateEvidenceUsefulness(profileSlug, decision.evidence, input.outcome, observedAt);
      updateWorldModel(profileSlug, decision, { outcome: input.outcome, strategyId: input.strategyId }, observedAt);
    }
  })();
  if (decision) {
    try { trainNeuralPredictor(); } catch { /* prediction refinement must never block feedback */ }
  }
  return id;
}

function observationsFromOutcome(
  profileSlug: string, sourceId: string, input: LinkedOutcome, observedAt: string,
): StructuredObservation[] {
  const outcome = { positive: .72, neutral: .08, negative: -.62, no_reply: -.72 }[input.outcome];
  const signals = input.signals ?? {};
  const rows: Array<[BeliefDimension, number, number, string]> = [
    ["engagement", outcome, .78, "真实后续反馈反映本轮互动投入"],
    ["communication_willingness", input.outcome === "no_reply" ? -.8 : Math.max(-.7, 1 - Number(input.responseDelayHours ?? 6) / 24), .76, "真实回复与时延信号"],
    ["momentum", outcome * .8, .7, "本轮结果对互动势头的短期影响"],
  ];
  if (signals.initiated !== undefined) rows.push(["initiative", signals.initiated ? .9 : -.25, .88, "是否由对方主动延续"]);
  if (signals.followedThrough) rows.push(["commitment_reliability", 1, .96, "实际兑现约定"]);
  if (signals.brokePromise) rows.push(["commitment_reliability", -1, .96, "实际未兑现约定"]);
  if (signals.rememberedDetail) rows.push(["consistency", .68, .78, "记得过往细节，支持言行连续"]);
  if (signals.forgotDetail) rows.push(["consistency", -.55, .72, "忘记过往细节，降低连续性证据"]);
  return rows.map(([dimension, value, confidence, rationale]) => ({
    id: crypto.randomUUID(), profileSlug, sourceId, dimension, value,
    confidence, reliability: .9, observedAt, rationale,
  }));
}

function contextKey(report: DecisionReport | null): string {
  if (!report) return "global";
  const dominant = report.hypotheses[0]?.id ?? "unknown";
  return `${report.planningMode}:${dominant}`;
}

function outcomeValue(outcome: LinkedOutcome["outcome"]): number {
  return { positive: 1, neutral: 0.55, negative: 0.08, no_reply: 0.15 }[outcome];
}

function updatePosterior(profileSlug: string, context: string, family: string, outcome: LinkedOutcome["outcome"], observedAt: string, halfLifeDays = 120): void {
  const conn = db();
  const row = conn.query(`SELECT alpha, beta, effective_samples, updated_at FROM strategy_posteriors
    WHERE profile_slug=? AND context_key=? AND strategy_family=?`).get(profileSlug, context, family) as any;
  const ageDays = row ? Math.max(0, (Date.parse(observedAt) - Date.parse(row.updated_at)) / 86_400_000) : 0;
  const decay = Math.pow(0.5, ageDays / halfLifeDays);
  const alpha = row ? 1.5 + (Number(row.alpha) - 1.5) * decay : 1.5;
  const beta = row ? 1.5 + (Number(row.beta) - 1.5) * decay : 1.5;
  const value = outcomeValue(outcome);
  conn.query(`INSERT INTO strategy_posteriors(
    profile_slug, context_key, strategy_family, alpha, beta, effective_samples, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(profile_slug, context_key, strategy_family) DO UPDATE SET
    alpha=excluded.alpha, beta=excluded.beta, effective_samples=excluded.effective_samples,
    updated_at=excluded.updated_at`).run(
      profileSlug, context, family, alpha + value, beta + 1 - value,
      (row ? Number(row.effective_samples) * decay : 0) + 1, observedAt,
    );
}

function updateEvidenceUsefulness(profileSlug: string, evidence: EvidenceRef[], outcome: LinkedOutcome["outcome"], at: string): void {
  const value = outcomeValue(outcome);
  const conn = db();
  const upsert = conn.query(`INSERT INTO evidence_usefulness(
    profile_slug, evidence_id, useful, harmful, uses, updated_at
  ) VALUES (?, ?, ?, ?, 1, ?)
  ON CONFLICT(profile_slug, evidence_id) DO UPDATE SET
    useful=useful+excluded.useful, harmful=harmful+excluded.harmful,
    uses=uses+1, updated_at=excluded.updated_at`);
  for (const item of evidence) upsert.run(profileSlug, item.id, value, 1 - value, at);
}

export function posteriorFor(profileSlug: string, context: string, family: string): { mean: number; samples: number } {
  const exact = db().query(`SELECT alpha, beta, effective_samples FROM strategy_posteriors
    WHERE profile_slug=? AND context_key=? AND strategy_family=?`).get(profileSlug, context, family) as any;
  const global = db().query(`SELECT SUM(alpha-1.5)+1.5 AS alpha, SUM(beta-1.5)+1.5 AS beta,
    SUM(effective_samples) AS effective_samples FROM strategy_posteriors
    WHERE profile_slug=? AND strategy_family=?`).get(profileSlug, family) as any;
  const row = exact?.effective_samples ? exact : global;
  const alpha = Math.max(0.1, Number(row?.alpha ?? 1.5));
  const beta = Math.max(0.1, Number(row?.beta ?? 1.5));
  return { mean: alpha / (alpha + beta), samples: Number(row?.effective_samples ?? 0) };
}

export function usefulnessFor(profileSlug: string, evidenceId: string): number {
  const row = db().query(`SELECT useful, harmful FROM evidence_usefulness
    WHERE profile_slug=? AND evidence_id=?`).get(profileSlug, evidenceId) as any;
  return row ? (Number(row.useful) + 1) / (Number(row.useful) + Number(row.harmful) + 2) : 0.5;
}

// ---------------------------------------------------------------------------
// World-model learning: decayed response counts, transition residuals and a
// predictive-log-loss gate that tracks whether the model beats base rates.
// ---------------------------------------------------------------------------

const WORLD_HALF_LIFE_DAYS = 120;
const RESPONSE_BASE_RATES: Record<ResponseClass, number> = { positive: .35, neutral: .3, negative: .15, no_reply: .2 };
/** Residuals are learned only on dimensions a recorded outcome actually observes. */
const RESIDUAL_DIMENSIONS: BeliefDimension[] = ["engagement", "communication_willingness", "momentum"];

// ---------------------------------------------------------------------------
// Temporal-CNN response predictor: dataset assembly, gated training, loading.
// One global (per-install) net — all data stays on this machine.
// ---------------------------------------------------------------------------

const NEURAL_MIN_SAMPLES = 8;
const NEURAL_GATE_NATS = .02;
const NEURAL_SEED = 7;
const RESPONSE_INDEX: Record<ResponseClass, number> = { positive: 0, neutral: 1, negative: 2, no_reply: 3 };

interface NeuralExample extends TrainingExample {
  /** The head's stored prediction for the realized outcome (gate baseline). */
  baselineProb: number;
  observedAt: string;
}

/** Rebuild the full training set from immutable decision reports and their
 * linked outcomes: grid at decision time, φ(a), regime posterior, label. */
function neuralTrainingSet(): NeuralExample[] {
  const rows = db().query(`SELECT o.profile_slug, o.outcome, o.strategy_id, o.observed_at, r.report_json
    FROM outcome_events o JOIN decision_runs r
      ON r.profile_slug = o.profile_slug AND r.id = o.decision_id
    ORDER BY o.observed_at`).all() as any[];
  const examples: NeuralExample[] = [];
  for (const row of rows) {
    const report = parseJson<DecisionReport | null>(row.report_json, null);
    const label = RESPONSE_INDEX[row.outcome as ResponseClass];
    if (!report || label === undefined) continue;
    const family = report.strategies.find((s) => s.id === row.strategy_id)?.family
      ?? report.selectedStrategy.family;
    const decidedAt = Date.parse(report.createdAt);
    const observations = db().query(`SELECT dimension, value, confidence, reliability, observed_at
      FROM structured_observations WHERE profile_slug=? AND observed_at<?
      ORDER BY observed_at DESC LIMIT 400`).all(row.profile_slug, report.createdAt) as any[];
    const grid = buildObservationGrid(observations.map((o) => ({
      dimension: o.dimension, value: Number(o.value), confidence: Number(o.confidence),
      reliability: Number(o.reliability), observedAt: String(o.observed_at),
    })), decidedAt);
    const branches = report.simulations.filter((b) =>
      b.strategyId === (row.strategy_id ?? report.selectedStrategy.id) && b.responseDistribution);
    const branchMass = branches.reduce((sum, b) => sum + b.probability, 0);
    const baselineProb = branchMass
      ? branches.reduce((sum, b) => sum + b.probability * (b.responseDistribution![row.outcome as ResponseClass] ?? 0), 0) / branchMass
      : RESPONSE_BASE_RATES[row.outcome as ResponseClass];
    examples.push({
      grid,
      extra: [...actionFeatureVector(family), ...regimePosteriorVector(report.hypotheses)],
      label, baselineProb, observedAt: String(row.observed_at),
    });
  }
  return examples;
}

/** Train the global CNN. Gating metrics come from a time-ordered 75/25 split
 * (never random — later outcomes must not leak into the past); the deployed
 * weights are then retrained on the full set with the same seed. */
export function trainNeuralPredictor(): { samples: number; holdoutModel: number | null; holdoutBase: number | null } | null {
  const examples = neuralTrainingSet();
  if (examples.length < NEURAL_MIN_SAMPLES) {
    db().query("DELETE FROM neural_predictor WHERE scope='global'").run();
    return null;
  }
  const epochs = Math.min(220, 80 + examples.length * 4);
  const holdCount = Math.max(2, Math.floor(examples.length / 4));
  const trainSlice = examples.slice(0, examples.length - holdCount);
  const holdout = examples.slice(examples.length - holdCount);
  const gateModel = trainCnn(trainSlice, { seed: NEURAL_SEED, epochs });
  const holdoutModel = meanLogLoss(gateModel.weights, holdout);
  const holdoutBase = holdout.reduce((sum, e) => sum - Math.log(Math.max(1e-12, e.baselineProb)), 0) / holdout.length;
  const deployed = trainCnn(examples, { seed: NEURAL_SEED, epochs });
  db().query(`INSERT INTO neural_predictor(scope, weights_json, samples, params, holdout_model, holdout_base, trained_at)
    VALUES ('global', ?, ?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET
    weights_json=excluded.weights_json, samples=excluded.samples, params=excluded.params,
    holdout_model=excluded.holdout_model, holdout_base=excluded.holdout_base, trained_at=excluded.trained_at`).run(
      JSON.stringify(deployed.weights), examples.length, parameterCount(),
      holdoutModel, holdoutBase, new Date().toISOString(),
    );
  return { samples: examples.length, holdoutModel, holdoutBase };
}

export interface NeuralPredictorState {
  weights: CnnWeights;
  samples: number;
  params: number;
  holdoutModel: number | null;
  holdoutBase: number | null;
  /** min(.5, n/(n+12)) when the holdout advantage clears the gate, else 0. */
  trust: number;
}

export function loadNeuralPredictor(): NeuralPredictorState | null {
  const row = db().query(`SELECT weights_json, samples, params, holdout_model, holdout_base
    FROM neural_predictor WHERE scope='global'`).get() as any;
  if (!row) return null;
  const weights = parseJson<CnnWeights | null>(row.weights_json, null);
  if (!weights) return null;
  const holdoutModel = row.holdout_model === null ? null : Number(row.holdout_model);
  const holdoutBase = row.holdout_base === null ? null : Number(row.holdout_base);
  const advantage = holdoutModel !== null && holdoutBase !== null ? holdoutBase - holdoutModel : 0;
  const samples = Number(row.samples);
  const trust = advantage > NEURAL_GATE_NATS ? Math.min(.5, samples / (samples + 12)) : 0;
  return { weights, samples, params: Number(row.params), holdoutModel, holdoutBase, trust };
}

export function loadWorldModel(profileSlug: string): WorldModelSnapshot {
  const rows = db().query(`SELECT regime, strategy_family, counts_json, delta_json, effective
    FROM world_model_stats WHERE profile_slug=?`).all(profileSlug) as any[];
  const entries: Record<string, LearnedRegimeFamily> = {};
  for (const row of rows) {
    entries[`${row.regime}:${row.strategy_family}`] = {
      counts: parseJson(row.counts_json, {}), delta: parseJson(row.delta_json, {}),
      effective: Number(row.effective),
    };
  }
  const gate = db().query(`SELECT log_loss_model, log_loss_base, samples
    FROM world_model_gate WHERE profile_slug=?`).get(profileSlug) as any;
  return {
    entries,
    gate: {
      logLossModel: Number(gate?.log_loss_model ?? 0), logLossBase: Number(gate?.log_loss_base ?? 0),
      samples: Number(gate?.samples ?? 0),
    },
  };
}

/** The report stores what the model predicted at decision time, so a later real
 * outcome scores the prediction (log loss vs base rates) and updates the
 * Dirichlet response counts and mean transition residuals for (regime, family). */
export function updateWorldModel(
  profileSlug: string, report: DecisionReport,
  outcome: { outcome: ResponseClass; strategyId?: string }, observedAt: string,
): void {
  const family = report.strategies.find((s) => s.id === outcome.strategyId)?.family
    ?? report.selectedStrategy.family;
  const regime = report.hypotheses[0]?.id ?? "unknown";
  const branches = report.simulations.filter((b) =>
    b.strategyId === (outcome.strategyId ?? report.selectedStrategy.id) && b.responseDistribution);
  const mass = branches.reduce((sum, b) => sum + b.probability, 0);
  const predicted = Object.fromEntries(RESPONSE_CLASSES.map((cls) => [
    cls,
    mass ? branches.reduce((sum, b) => sum + b.probability * (b.responseDistribution![cls] ?? 0), 0) / mass
      : RESPONSE_BASE_RATES[cls],
  ])) as Record<ResponseClass, number>;

  const conn = db();
  const row = conn.query(`SELECT counts_json, delta_json, effective, updated_at FROM world_model_stats
    WHERE profile_slug=? AND regime=? AND strategy_family=?`).get(profileSlug, regime, family) as any;
  const ageDays = row ? Math.max(0, (Date.parse(observedAt) - Date.parse(row.updated_at)) / 86_400_000) : 0;
  const halfLife = report.timescales?.learningDays ?? WORLD_HALF_LIFE_DAYS;
  const decay = Math.pow(.5, ageDays / halfLife);
  const counts = parseJson<Partial<Record<ResponseClass, number>>>(row?.counts_json, {});
  for (const cls of RESPONSE_CLASSES) counts[cls] = (counts[cls] ?? 0) * decay;
  counts[outcome.outcome] = (counts[outcome.outcome] ?? 0) + 1;
  const effective = (row ? Number(row.effective) * decay : 0) + 1;

  // Residual target: what the outcome observations say the state moved to,
  // minus what the transition model predicted. Decayed running mean per dim.
  const delta = parseJson<Partial<Record<BeliefDimension, number>>>(row?.delta_json, {});
  const dominantBranch = branches.sort((a, b) => b.probability - a.probability)[0];
  if (dominantBranch?.predictedState) {
    const observedValue: Partial<Record<BeliefDimension, number>> = {
      engagement: { positive: .72, neutral: .08, negative: -.62, no_reply: -.72 }[outcome.outcome],
      communication_willingness: outcome.outcome === "no_reply" ? -.8 : .35,
      momentum: { positive: .58, neutral: .06, negative: -.5, no_reply: -.58 }[outcome.outcome],
    };
    const step = 1 / Math.min(24, effective + 1);
    for (const dimension of RESIDUAL_DIMENSIONS) {
      const residual = Number(observedValue[dimension]) - Number(dominantBranch.predictedState[dimension] ?? 0);
      const previous = Number(delta[dimension] ?? 0);
      delta[dimension] = Math.max(-.5, Math.min(.5, previous + step * (residual - previous)));
    }
  }

  conn.query(`INSERT INTO world_model_stats(
    profile_slug, regime, strategy_family, counts_json, delta_json, effective, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(profile_slug, regime, strategy_family) DO UPDATE SET
    counts_json=excluded.counts_json, delta_json=excluded.delta_json,
    effective=excluded.effective, updated_at=excluded.updated_at`).run(
      profileSlug, regime, family, JSON.stringify(counts), JSON.stringify(delta), effective, observedAt,
    );

  const gate = conn.query(`SELECT log_loss_model, log_loss_base, samples FROM world_model_gate
    WHERE profile_slug=?`).get(profileSlug) as any;
  const gateDecay = Math.pow(.5, ageDays / halfLife);
  conn.query(`INSERT INTO world_model_gate(profile_slug, log_loss_model, log_loss_base, samples, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(profile_slug) DO UPDATE SET
    log_loss_model=excluded.log_loss_model, log_loss_base=excluded.log_loss_base,
    samples=excluded.samples, updated_at=excluded.updated_at`).run(
      profileSlug,
      Number(gate?.log_loss_model ?? 0) * gateDecay - Math.log(Math.max(.02, predicted[outcome.outcome])),
      Number(gate?.log_loss_base ?? 0) * gateDecay - Math.log(RESPONSE_BASE_RATES[outcome.outcome]),
      Number(gate?.samples ?? 0) * gateDecay + 1, observedAt,
    );
}

export function readDecisionCache<T>(key: string): T | null {
  const row = db().query(`SELECT value_json FROM decision_cache
    WHERE cache_key=? AND expires_at>?`).get(key, new Date().toISOString()) as any;
  return row ? parseJson<T>(row.value_json, null as unknown as T) : null;
}

export function writeDecisionCache(key: string, value: unknown, provider: string, schema: string, ttlMs = 86_400_000): void {
  const now = new Date();
  db().query(`INSERT INTO decision_cache(cache_key, value_json, provider, schema_name, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET
    value_json=excluded.value_json, provider=excluded.provider, schema_name=excluded.schema_name,
    created_at=excluded.created_at, expires_at=excluded.expires_at`).run(
      key, JSON.stringify(value), provider, schema, now.toISOString(), new Date(now.getTime() + ttlMs).toISOString(),
    );
}

export function syncPatternRegistry(profileSlug: string, patterns: PatternSignal[]): PatternSignal[] {
  const conn = db();
  const now = new Date().toISOString();
  const upsert = conn.query(`INSERT INTO pattern_registry(
    profile_slug, pattern_id, label, lifecycle, support, counterexamples,
    confidence, explanation, first_seen_at, last_seen_at, version, metadata_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(profile_slug, pattern_id) DO UPDATE SET label=excluded.label,
    lifecycle=excluded.lifecycle, support=excluded.support,
    counterexamples=excluded.counterexamples, confidence=excluded.confidence,
    explanation=excluded.explanation, last_seen_at=excluded.last_seen_at,
    version=excluded.version, metadata_json=excluded.metadata_json`);
  conn.transaction(() => {
    for (const pattern of patterns) {
      const previous = conn.query(`SELECT lifecycle, first_seen_at, version FROM pattern_registry
        WHERE profile_slug=? AND pattern_id=?`).get(profileSlug, pattern.id) as any;
      const automatic = pattern.validated ? "active"
        : pattern.support + pattern.counterexamples >= 4 && pattern.counterexamples >= pattern.support ? "watch"
        : "candidate";
      const lifecycle = previous && ["retired", "rejected"].includes(String(previous.lifecycle))
        ? String(previous.lifecycle) : automatic;
      const version = Number(previous?.version ?? 0) + 1;
      upsert.run(profileSlug, pattern.id, pattern.label, lifecycle, pattern.support,
        pattern.counterexamples, pattern.confidence, pattern.explanation,
        previous?.first_seen_at ?? now, now, version,
        JSON.stringify({ validated: pattern.validated }));
      if (!previous || previous.lifecycle !== lifecycle) appendDecisionEvent(profileSlug, "pattern.lifecycle_changed", {
        patternId: pattern.id, from: previous?.lifecycle ?? null, to: lifecycle, automatic: true,
      }, { observedAt: now });
    }
  })();
  return readPatternRegistry(profileSlug);
}

export function readPatternRegistry(profileSlug: string): PatternSignal[] {
  const rows = db().query(`SELECT pattern_id, label, lifecycle, support, counterexamples,
    confidence, explanation, first_seen_at, last_seen_at, metadata_json
    FROM pattern_registry WHERE profile_slug=? ORDER BY
    CASE lifecycle WHEN 'active' THEN 0 WHEN 'watch' THEN 1 WHEN 'candidate' THEN 2 ELSE 3 END,
    confidence DESC`).all(profileSlug) as any[];
  return rows.map((row) => ({
    id: row.pattern_id, label: row.label, lifecycle: row.lifecycle,
    support: Number(row.support), counterexamples: Number(row.counterexamples),
    confidence: Number(row.confidence), validated: Boolean(parseJson(row.metadata_json, { validated: false }).validated),
    explanation: row.explanation, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at,
  }));
}

export function updatePatternLifecycle(
  profileSlug: string, patternId: string,
  lifecycle: NonNullable<PatternSignal["lifecycle"]>,
): PatternSignal | null {
  if (!["candidate", "active", "watch", "retired", "rejected"].includes(lifecycle)) throw new Error("不支持这个模式状态");
  const previous = db().query(`SELECT lifecycle FROM pattern_registry
    WHERE profile_slug=? AND pattern_id=?`).get(profileSlug, patternId) as any;
  if (!previous) return null;
  const now = new Date().toISOString();
  db().query(`UPDATE pattern_registry SET lifecycle=?, last_seen_at=?, version=version+1
    WHERE profile_slug=? AND pattern_id=?`).run(lifecycle, now, profileSlug, patternId);
  appendDecisionEvent(profileSlug, "pattern.lifecycle_changed", {
    patternId, from: previous.lifecycle, to: lifecycle, automatic: false,
  }, { observedAt: now });
  return readPatternRegistry(profileSlug).find((item) => item.id === patternId) ?? null;
}

export function strategyPerformance(profileSlug: string) {
  const rows = db().query(`SELECT o.outcome, o.observed_at, o.strategy_id, r.report_json
    FROM outcome_events o LEFT JOIN decision_runs r
      ON r.profile_slug=o.profile_slug AND r.id=o.decision_id
    WHERE o.profile_slug=? ORDER BY o.observed_at`).all(profileSlug) as any[];
  const now = Date.now();
  const families = new Map<string, Array<{ value: number; at: number; halfLife: number }>>();
  for (const row of rows) {
    const report = row.report_json ? parseJson<DecisionReport | null>(row.report_json, null) : null;
    const family = report?.strategies.find((item) => item.id === row.strategy_id)?.family
      ?? report?.selectedStrategy.family ?? "unknown";
    const list = families.get(family) ?? [];
    list.push({ value: outcomeValue(row.outcome), at: Date.parse(row.observed_at), halfLife: report?.timescales?.learningDays ?? 120 });
    families.set(family, list);
  }
  const summary = [...families.entries()].map(([family, values]) => {
    const decayed = values.map((item) => ({ ...item, weight: Math.pow(.5, Math.max(0, now - item.at) / 86_400_000 / item.halfLife) }));
    const alpha = 1.5 + decayed.reduce((sum, item) => sum + item.value * item.weight, 0);
    const beta = 1.5 + decayed.reduce((sum, item) => sum + (1 - item.value) * item.weight, 0);
    const recent = values.filter((item) => now - item.at <= 30 * 86_400_000);
    const prior = values.filter((item) => now - item.at > 30 * 86_400_000 && now - item.at <= 60 * 86_400_000);
    const average = (items: typeof values) => items.length ? items.reduce((s, x) => s + x.value, 0) / items.length : null;
    const recentScore = average(recent);
    const priorScore = average(prior);
    return {
      family, samples: values.length, effectiveSamples: decayed.reduce((s, x) => s + x.weight, 0),
      score: alpha / (alpha + beta), confidence: 1 - Math.exp(-values.length / 5),
      recent30: recentScore, prior30: priorScore,
      trend: recentScore !== null && priorScore !== null ? recentScore - priorScore : null,
      positive: values.filter((item) => item.value >= .75).length,
      negative: values.filter((item) => item.value <= .2).length,
    };
  }).sort((a, b) => b.samples - a.samples || b.score - a.score);
  return { totalOutcomes: rows.length, strategies: summary };
}

export function recordCalibrationExample(
  report: DecisionReport, outcome: LinkedOutcome, consentVersion = "2026-07-v1",
): string {
  const id = crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  // Intentionally omit profile slug, names, raw messages, reply text and partner response.
  const features = {
    planningMode: report.planningMode,
    beliefs: Object.fromEntries(report.beliefs.map((item) => [item.dimension, {
      mean: round(item.mean), variance: round(item.variance), confidence: round(item.confidence),
      changing: item.changing, conflicted: item.conflicted,
    }])),
    hypotheses: report.hypotheses.map((item) => ({ id: item.id, probability: round(item.probability) })),
    patternIds: report.patterns.filter((item) => item.lifecycle === "active" || item.validated).map((item) => item.id),
    evidenceKinds: report.evidence.reduce<Record<string, number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1; return acc;
    }, {}),
    uncertainty: round(report.uncertainty.total),
  };
  const prediction = {
    strategyFamily: report.selectedStrategy.family,
    strategyScore: round(report.selectedStrategy.score),
    abstained: report.uncertainty.abstain,
  };
  const result = {
    outcome: outcome.outcome,
    outcomeValue: round(outcomeValue(outcome.outcome)),
    delayBucket: delayBucket(outcome.responseDelayHours),
    signals: Object.fromEntries(Object.entries(outcome.signals ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => [key, Boolean(value)])),
  };
  db().query(`INSERT INTO calibration_examples(
    id, consent_version, captured_at, features_json, prediction_json, outcome_json
  ) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, consentVersion, capturedAt, JSON.stringify(features), JSON.stringify(prediction), JSON.stringify(result),
  );
  return id;
}

function round(value: number): number { return Math.round(value * 1000) / 1000; }
function delayBucket(hours?: number): string {
  if (hours === undefined || !Number.isFinite(hours)) return "unknown";
  if (hours < 1) return "under_1h";
  if (hours < 8) return "same_day";
  if (hours < 30) return "next_day";
  if (hours < 96) return "few_days";
  return "longer";
}

export function calibrationDataset() {
  const rows = db().query(`SELECT id, consent_version, captured_at, features_json,
    prediction_json, outcome_json FROM calibration_examples
    WHERE deleted_at IS NULL ORDER BY captured_at`).all() as any[];
  return {
    schema: "dianzi-junshi-calibration-v1", exportedAt: new Date().toISOString(),
    privacy: "Contains no profile identifiers, names, raw messages, replies, or partner responses.",
    examples: rows.map((row) => ({
      id: row.id, consentVersion: row.consent_version, capturedAt: row.captured_at,
      features: parseJson(row.features_json, {}), prediction: parseJson(row.prediction_json, {}),
      outcome: parseJson(row.outcome_json, {}),
    })),
  };
}

export function calibrationReport() {
  const examples = calibrationDataset().examples as any[];
  if (!examples.length) return { samples: 0, brierScore: null, expectedSuccess: null, observedSuccess: null, calibrationError: null };
  const pairs = examples.map((item) => ({ p: Number(item.prediction.strategyScore), y: Number(item.outcome.outcomeValue) }));
  const bins = Array.from({ length: 5 }, (_, index) => {
    const rows = pairs.filter((item) => Math.min(4, Math.floor(item.p * 5)) === index);
    return rows.length ? { count: rows.length, predicted: rows.reduce((s, x) => s + x.p, 0) / rows.length,
      observed: rows.reduce((s, x) => s + x.y, 0) / rows.length } : null;
  }).filter(Boolean) as Array<{ count: number; predicted: number; observed: number }>;
  return {
    samples: pairs.length,
    brierScore: pairs.reduce((sum, item) => sum + (item.p - item.y) ** 2, 0) / pairs.length,
    expectedSuccess: pairs.reduce((sum, item) => sum + item.p, 0) / pairs.length,
    observedSuccess: pairs.reduce((sum, item) => sum + item.y, 0) / pairs.length,
    calibrationError: bins.reduce((sum, bin) => sum + bin.count / pairs.length * Math.abs(bin.predicted - bin.observed), 0),
    bins,
  };
}

export function deleteCalibrationDataset(): number {
  const result = db().query(`UPDATE calibration_examples SET deleted_at=? WHERE deleted_at IS NULL`)
    .run(new Date().toISOString());
  return Number(result.changes ?? 0);
}

export function rebuildDerivedState(profileSlug: string): { events: number; outcomes: number; observations: number } {
  const conn = db();
  const events = readDecisionEvents(profileSlug);
  const legacyObservations = conn.query("SELECT COUNT(*) AS count FROM trait_observations WHERE profile_slug=?").get(profileSlug) as any;
  const outcomeCount = events.filter((event) => event.type === "outcome.recorded").length;
  // Decision reports are immutable audit records. Rebuild only mutable learning projections.
  conn.transaction(() => {
    conn.query("DELETE FROM strategy_posteriors WHERE profile_slug=?").run(profileSlug);
    conn.query("DELETE FROM evidence_usefulness WHERE profile_slug=?").run(profileSlug);
    conn.query("DELETE FROM structured_observations WHERE profile_slug=?").run(profileSlug);
    conn.query("DELETE FROM world_model_stats WHERE profile_slug=?").run(profileSlug);
    conn.query("DELETE FROM world_model_gate WHERE profile_slug=?").run(profileSlug);
    const observations = events.filter((event) => event.type === "observation.extracted").map((event) => ({
      id: String(event.payload.observationId), profileSlug, sourceId: String(event.payload.sourceId),
      dimension: String(event.payload.dimension) as BeliefDimension, value: Number(event.payload.value),
      confidence: Number(event.payload.confidence), reliability: Number(event.payload.reliability),
      observedAt: event.observedAt, rationale: String(event.payload.rationale ?? "由事件重建"),
    }));
    saveObservations(observations);
    const outcomes = conn.query(`SELECT outcome, observed_at, decision_id, strategy_id
      FROM outcome_events WHERE profile_slug=? ORDER BY observed_at`).all(profileSlug) as any[];
    for (const row of outcomes) {
      const report = row.decision_id ? getDecisionReport(profileSlug, row.decision_id) : null;
      const family = report?.strategies.find((s) => s.id === row.strategy_id)?.family ?? report?.selectedStrategy.family;
      if (family) updatePosterior(profileSlug, contextKey(report), family, row.outcome, row.observed_at, report?.timescales?.learningDays ?? 120);
      if (report) {
        updateEvidenceUsefulness(profileSlug, report.evidence, row.outcome, row.observed_at);
        updateWorldModel(profileSlug, report, { outcome: row.outcome, strategyId: row.strategy_id ?? undefined }, row.observed_at);
      }
    }
  })();
  try { trainNeuralPredictor(); } catch { /* projection rebuild still succeeds without the CNN */ }
  return { events: events.length, outcomes: outcomeCount, observations: Number(legacyObservations?.count ?? 0) + readObservations(profileSlug).length };
}

export function decisionDiagnostics(profileSlug: string): Record<string, unknown> {
  const conn = db();
  const count = (table: string) => Number((conn.query(`SELECT COUNT(*) AS count FROM ${table} WHERE profile_slug=?`).get(profileSlug) as any)?.count ?? 0);
  const world = loadWorldModel(profileSlug);
  return {
    schemaVersion: Number((conn.query("SELECT MAX(version) AS version FROM schema_migrations").get() as any)?.version ?? 0),
    counts: {
      events: count("decision_events"), observations: count("structured_observations"),
      facts: count("temporal_facts"), decisions: count("decision_runs"), outcomes: count("outcome_events"),
    },
    worldModel: {
      learnedContexts: Object.keys(world.entries).length,
      samples: world.gate.samples,
      meanLogLossModel: world.gate.samples ? world.gate.logLossModel / world.gate.samples : null,
      meanLogLossBase: world.gate.samples ? world.gate.logLossBase / world.gate.samples : null,
      advantage: world.gate.samples ? (world.gate.logLossBase - world.gate.logLossModel) / world.gate.samples : null,
    },
    neuralPredictor: (() => {
      const neural = loadNeuralPredictor();
      return neural ? {
        samples: neural.samples, params: neural.params, trust: neural.trust,
        holdoutModel: neural.holdoutModel, holdoutBase: neural.holdoutBase,
        advantage: neural.holdoutModel !== null && neural.holdoutBase !== null
          ? neural.holdoutBase - neural.holdoutModel : null,
      } : { samples: 0, params: parameterCount(), trust: 0, holdoutModel: null, holdoutBase: null, advantage: null };
    })(),
    recent: listDecisionReports(profileSlug, 5).map((report) => ({
      id: report.id, createdAt: report.createdAt, mode: report.planningMode,
      strategy: report.selectedStrategy.family, uncertainty: report.uncertainty.total,
      durationMs: report.metrics.durationMs,
    })),
  };
}

export function resetDecisionStoreForTests(): void {
  migrated = false;
}

export type DecisionProjection = {
  beliefs: BeliefState[]; hypotheses: StateHypothesis[]; patterns: PatternSignal[];
  strategies: StrategyCandidate[]; simulations: SimulationBranch[]; critics: CriticScore[];
};
