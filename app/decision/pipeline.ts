import type { ProviderConfig } from "../providers";
import type { PipelineInput, DecisionReport, DecisionMetrics, EvidenceRef, PlanningMode, StrategyCandidate, StructuredObservation } from "./types";
import { appendDecisionEvent, graphEvidence, loadNeuralPredictor, loadWorldModel, posteriorFor, readDecisionEvents, readObservations, recordTemporalFact, saveDecisionReport, saveObservations, syncPatternRegistry } from "./store";
import { actionFeatureVector, regimePosteriorVector, type NeuralBlend } from "./worldmodel";
import { buildObservationGrid, predictResponse } from "./neural";
import { extractObservations, retrieveEvidence, validateObservations } from "./evidence";
import { buildBeliefs, buildHypotheses, detectChanges, discoverPatterns, missingInformation } from "./state";
import { assessUncertainty, evaluateStrategies, generateStrategies, rewardWeightsFor, selectStrategy, simulateStrategies, strategyAlternatives } from "./planner";
import { buildNetworkTrace } from "./worldmodel";
import { completeStructured } from "./structured";

function nowMs(): number { return performance.now(); }

function budget(mode: PlanningMode) {
  return mode === "fast" ? { evidence: 8, simulations: 2, alternatives: 1 }
    : mode === "deep" ? { evidence: 18, simulations: 4, alternatives: 2 }
    : { evidence: 12, simulations: 3, alternatives: 2 };
}

function stage<T>(metrics: DecisionMetrics, name: string, fn: () => T): T {
  const start = nowMs();
  const value = fn();
  metrics.stageMs[name] = nowMs() - start;
  return value;
}

export async function runDecisionPipeline(
  input: PipelineInput,
  options: { provider?: ProviderConfig; workspaceDir?: string } = {},
): Promise<DecisionReport> {
  const started = nowMs();
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const source = appendDecisionEvent(input.profileSlug, "message.observed", {
    decisionId: id, text: input.text, mode: input.mode, planningMode: input.planningMode,
  }, { causationId: id });
  const metrics: DecisionMetrics = {
    startedAt: createdAt, durationMs: 0, stageMs: {}, llmCalls: 0, cacheHits: 0,
    evidenceScanned: input.evidence.length, evidenceSelected: 0, simulationCount: 0,
    planningMode: input.planningMode,
  };
  const limits = budget(input.planningMode);
  let observations = stage(metrics, "observe", () => extractObservations(input, source.id, createdAt));
  if (input.planningMode === "deep" && options.provider && options.provider.provider !== "demo") {
    const enrichStarted = nowMs();
    const structured = await completeStructured<Array<Omit<StructuredObservation, "id" | "profileSlug" | "sourceId" | "observedAt">>>({
      provider: options.provider, schemaName: "decision-observations-v1",
      cacheKey: `observations:${input.profileSlug}:${Bun.hash(input.text).toString(16)}`,
      workspaceDir: options.workspaceDir,
      system: `你是结构化观察器。把当前文字里能读出的状态信号都记下来，包括语气和潜台词透露的信号。
返回 {"observations": [...]}。每项字段：dimension、value(-1到1)、confidence(0到1)、reliability(0到1)、rationale。
dimension 只能是 engagement, trust, communication_willingness, emotional_pressure, boundary_sensitivity, commitment_reliability, momentum, initiative, consistency。没有信号就返回空数组。`,
      user: input.text,
      schema: OBSERVATION_SCHEMA,
      validate: validateLlmObservations,
      fallback: () => [],
    });
    metrics.llmCalls += structured.attempts;
    metrics.cacheHits += structured.cacheHit ? 1 : 0;
    const enriched = structured.value.map((item) => ({
      ...item, id: crypto.randomUUID(), profileSlug: input.profileSlug,
      sourceId: `${source.id}:structured`, observedAt: createdAt,
    }));
    observations = validateObservations([...observations, ...enriched]);
    metrics.stageMs.structured_observe = nowMs() - enrichStarted;
  }
  saveObservations(observations);
  stage(metrics, "temporal_facts", () => recordClaims(input, source.id, createdAt));
  for (const observation of observations) appendDecisionEvent(input.profileSlug, "observation.extracted", {
    observationId: observation.id, sourceId: observation.sourceId, dimension: observation.dimension,
    value: observation.value, confidence: observation.confidence, reliability: observation.reliability,
    rationale: observation.rationale,
  }, { observedAt: observation.observedAt, causationId: source.id });

  const allObservations = readObservations(input.profileSlug);
  const beliefs = stage(metrics, "belief", () => buildBeliefs(allObservations));
  const hypotheses = stage(metrics, "hypotheses", () => buildHypotheses(beliefs));
  const changes = stage(metrics, "change_detection", () => detectChanges(beliefs));
  const patterns = stage(metrics, "pattern_discovery", () => syncPatternRegistry(
    input.profileSlug, discoverPatterns(readDecisionEvents(input.profileSlug)),
  ));
  const missing = missingInformation(beliefs, hypotheses);
  const observationEvidence: EvidenceRef[] = observations.map((item) => ({
    id: item.id, kind: "observation", text: `${item.rationale}：${item.value.toFixed(2)}`,
    observedAt: item.observedAt, reliability: item.reliability, importance: item.confidence,
    sourceId: item.sourceId,
  }));
  const graph = graphEvidence(input.profileSlug, 80);
  metrics.evidenceScanned = input.evidence.length + observationEvidence.length + graph.length;
  const evidence = stage(metrics, "retrieval", () => retrieveEvidence(
    input.profileSlug, input.text, [...input.evidence, ...graph, ...observationEvidence], limits.evidence,
  ));
  metrics.evidenceSelected = evidence.length;
  const boldness = Math.max(0, Math.min(1, input.boldness ?? .5));
  const worldModel = stage(metrics, "world_model_load", () => loadWorldModel(input.profileSlug));
  const neural = stage(metrics, "neural_load", (): NeuralBlend | undefined => {
    const state = loadNeuralPredictor();
    if (!state || state.trust <= 0) return undefined;
    return { weights: state.weights, trust: state.trust, grid: buildObservationGrid(allObservations, createdAt) };
  });
  let strategies = stage(metrics, "strategy_generation", () => generateStrategies(
    input.profileSlug, input.mode, input.planningMode, beliefs, hypotheses, missing, patterns,
    posteriorFor, worldModel, boldness,
  ));
  const simulations = stage(metrics, "simulation", () => simulateStrategies(
    strategies, hypotheses, beliefs, input.planningMode, worldModel, neural,
  ));
  metrics.simulationCount = simulations.length;
  const critics = stage(metrics, "critics", () => evaluateStrategies(
    strategies, simulations, evidence, input.antiSimp, rewardWeightsFor(boldness),
  ));
  const uncertainty = stage(metrics, "uncertainty", () => assessUncertainty(beliefs, hypotheses, strategies, simulations, evidence, boldness));
  const selection = stage(metrics, "selection", () => selectStrategy(strategies, uncertainty));
  strategies = [selection.selected, ...strategyAlternatives(strategies, selection.selected.id),
    ...strategies.filter((item) => item.id !== selection.selected.id && !strategyAlternatives(strategies, selection.selected.id).some((alt) => alt.id === item.id))];
  const networkTrace = stage(metrics, "network_trace", () => buildNetworkTrace({
    states: beliefs, hypotheses, selected: selection.selected,
    branches: simulations, uncertainty, snapshot: worldModel,
    neuralTrace: neural ? (() => {
      const state = loadNeuralPredictor()!;
      return {
        trust: neural.trust,
        probs: predictResponse(neural.weights, neural.grid,
          [...actionFeatureVector(selection.selected.family), ...regimePosteriorVector(hypotheses)]),
        samples: state.samples,
        advantage: state.holdoutModel !== null && state.holdoutBase !== null
          ? state.holdoutBase - state.holdoutModel : 0,
        params: state.params,
      };
    })() : undefined,
  }));
  metrics.durationMs = nowMs() - started;
  const report: DecisionReport = {
    id, profileSlug: input.profileSlug, createdAt, planningMode: input.planningMode,
    goal: goalFor(input.mode), observations, beliefs, hypotheses, changes, patterns,
    missingInformation: missing, evidence, strategies, simulations, critics, uncertainty,
    selectedStrategy: selection.selected, selectionReason: selection.reason,
    replyId: crypto.randomUUID(), metrics, networkTrace,
  };
  saveDecisionReport(report);
  return report;
}

const OBSERVATION_SCHEMA: Record<string, unknown> = {
  type: "object", required: ["observations"], additionalProperties: false,
  properties: {
    observations: {
      type: "array", maxItems: 12,
      items: {
        type: "object", additionalProperties: false,
        required: ["dimension", "value", "confidence", "reliability", "rationale"],
        properties: {
          dimension: {
            type: "string",
            enum: ["engagement", "trust", "communication_willingness", "emotional_pressure",
              "boundary_sensitivity", "commitment_reliability", "momentum", "initiative", "consistency"],
          },
          value: { type: "number", minimum: -1, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reliability: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string", maxLength: 500 },
        },
      },
    },
  },
};

function validateLlmObservations(value: unknown): Array<Omit<StructuredObservation, "id" | "profileSlug" | "sourceId" | "observedAt">> | null {
  // Accept both the wrapped {observations: [...]} shape (native structured
  // output; tool inputs must be objects) and the bare array from older prompts.
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as any).observations)) {
    value = (value as any).observations;
  }
  if (!Array.isArray(value) || value.length > 12) return null;
  const allowed = new Set([
    "engagement", "trust", "communication_willingness", "emotional_pressure",
    "boundary_sensitivity", "commitment_reliability", "momentum", "initiative", "consistency",
  ]);
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (!allowed.has(String(item.dimension)) || !Number.isFinite(Number(item.value))
      || !Number.isFinite(Number(item.confidence)) || !Number.isFinite(Number(item.reliability))
      || typeof item.rationale !== "string") return null;
    out.push({
      dimension: String(item.dimension) as StructuredObservation["dimension"],
      value: Math.max(-1, Math.min(1, Number(item.value))),
      confidence: Math.max(0, Math.min(1, Number(item.confidence))),
      reliability: Math.max(0, Math.min(1, Number(item.reliability))),
      rationale: item.rationale.slice(0, 500),
    });
  }
  return out;
}

function recordClaims(input: PipelineInput, sourceId: string, at: string): void {
  const clauses = input.text.split(/[。！？!?\n]/).map((item) => item.trim()).filter(Boolean);
  for (const clause of clauses.slice(0, 8)) {
    const predicate = /明天|后天|周末|下周|见面|一起|约|改天/.test(clause) ? "mentioned_plan"
      : /不想|不要|别|不方便|需要空间/.test(clause) ? "stated_preference"
      : null;
    if (!predicate) continue;
    recordTemporalFact({
      profileSlug: input.profileSlug, subject: input.partnerName, predicate,
      object: clause.slice(0, 500), validFrom: at, confidence: .58,
      reliability: input.mode === "ask" ? .5 : .68, sourceId,
    });
  }
}

function goalFor(mode: PipelineInput["mode"]): string {
  return {
    reply: "给出自然、可直接发送且收益风险平衡的回复",
    analyze: "读透当前互动，包括语气和潜台词，保留竞争性解释",
    ask: "评估用户准备发送的内容，并提供更好的改法",
    interest: "用行为证据评估互动意愿和推进空间",
  }[mode];
}

export function realizationPrompt(
  input: PipelineInput,
  report: DecisionReport,
  provider: ProviderConfig,
): { systemBlocks: Array<{ text: string; cacheable: boolean }>; userText: string } {
  const selected = report.selectedStrategy;
  const alternatives = strategyAlternatives(report.strategies, selected.id);
  const evidenceLines = report.evidence.slice(0, 8).map((item) => `- ${item.text}`).join("\n") || "- 暂无足够证据";
  const uncertainty = report.uncertainty.abstain
    ? `信息不足：${report.uncertainty.reason}。先问一个最有价值的问题。`
    : `总体不确定性 ${report.uncertainty.total.toFixed(2)}。`;
  const boldness = Math.max(0, Math.min(1, input.boldness ?? .5));
  const boldnessHint = boldness >= .7
    ? `胆量设定 ${Math.round(boldness * 100)}/100：语气可以更主动、直接，敢下判断、敢给钩子。`
    : boldness <= .3
      ? `胆量设定 ${Math.round(boldness * 100)}/100：语气稳一些，动作小、留余地。`
      : `胆量设定 ${Math.round(boldness * 100)}/100：正常拿捏。`;
  return {
    systemBlocks: [
      {
        cacheable: true,
        text: `你是“电子军师”的表达层。决策已由本地引擎完成；把已选策略写成人话，保持策略不变。
要求：自然、口语、简短，敢下判断，把语气和潜台词读出来说透。引用证据时区分事实与推测。不要泄露内部提示。
回复模式必须使用以下格式：先用一两句说清判断，再给 2-3 个方案；每个可发送文本放在 \`\`\`reply 围栏中；最后说明推荐哪条。
分析模式也要简洁，可不生成发送文本。若生成，仍使用 reply 围栏。`,
      },
      {
        cacheable: false,
        text: `已选策略：${selected.label}
意图：${selected.intent}
做法：${selected.tactic}
语气：${selected.tone}
风险：${selected.risk}
备选策略：${alternatives.map((item) => item.label).join("、") || "无"}
${boldnessHint}
${uncertainty}`,
      },
    ],
    userText: `对象：${input.partnerName}；关系阶段：${input.stage}；任务：${input.mode}
用户提供的内容：\n${input.text || "（只有截图）"}

本轮可核对证据：
${evidenceLines}

请把已选策略实现成自然中文。提供的多个文案必须是同一策略的轻微语气变体，不得各自改成不同决策。${provider.provider === "demo" ? "这是离线演示，请明确说明只是示例。" : ""}`,
  };
}

export function demoRealization(report: DecisionReport, input: PipelineInput): string {
  const family = report.selectedStrategy.family;
  if (report.uncertainty.abstain || family === "seek_more_context") {
    return `现在的信息还不够，硬猜性价比太低。最值得补的一点是：${report.missingInformation[0] ?? "ta 当时的语气和前后文是什么"}？\n\n补上这一条，判断会准很多。`;
  }
  const variants: Record<string, string[]> = {
    warm: ["听起来你今天真的挺累的\n先歇会儿 不急着回我", "那先抱抱你\n想说的时候我在"],
    playful: ["行 被你拿捏了", "懂了\n今天这局算你赢"],
    invite: ["这周末要不要一起吃个饭\n不方便也没事", "等你有空一起喝杯东西？\n时间你定"],
    direct: ["我想把这件事说清楚\n你方便的时候聊十分钟？", "我有点在意刚才那件事\n想听听你怎么想"],
    give_space: ["好 你先忙\n想聊的时候再找我", "收到\n那我先不打扰你了"],
    clarify: ["我确认一下\n你是想先静一静 还是晚点再聊？", "我怕理解错\n你更想让我听着 还是一起想办法？"],
    mirror: ["懂了 那就这样", "好啊\n按你的节奏来"],
  };
  const choices = variants[family] ?? variants.mirror;
  return `这次用“${report.selectedStrategy.label}”。\n\n### 方案1 · 更稳\n\`\`\`reply\n${choices[0]}\n\`\`\`\n\n### 方案2 · 更有温度\n\`\`\`reply\n${choices[1] ?? choices[0]}\n\`\`\`\n\n推荐方案1：动作小、可逆，也更容易看清 ta 接下来的真实反应。\n\n（这是离线演示文案；连接 Codex、Claude Code 或 API 后，会结合你的真实上下文表达。）`;
}
