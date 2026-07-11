import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const home = mkdtempSync(join(tmpdir(), "dianzi-decision-test-"));
process.env.DIANZI_JUNSHI_HOME = home;
process.env.DJ_DISABLE_SQLITE_VEC = "1";

const store = await import(`./store.ts?decision=${Date.now()}`);
const adaptive = await import("./adaptive.ts");
const decisionStore = await import(`./decision/store.ts?decision=${Date.now()}`);
const pipeline = await import(`./decision/pipeline.ts?decision=${Date.now()}`);
const stateEngine = await import("./decision/state.ts");
const planner = await import("./decision/planner.ts");
const structured = await import("./decision/structured.ts");
const evaluation = await import("./decision/evaluation.ts");
const worldmodel = await import("./decision/worldmodel.ts");
const evidenceModule = await import(`./decision/evidence.ts?decision=${Date.now()}`);
const { BELIEF_DIMENSIONS } = await import("./decision/types.ts");

const DIM = (name: string) => BELIEF_DIMENSIONS.indexOf(name as never);

afterAll(() => {
  adaptive.resetAdaptiveDatabaseForTests();
  decisionStore.resetDecisionStoreForTests();
  rmSync(home, { recursive: true, force: true });
});

describe("adaptive decision engine", () => {
  test("repairs fenced JSON and trailing commas", () => {
    expect(structured.parseJsonWithRepair("```json\n{\"score\": 0.7,}\n```"))
      .toEqual({ score: .7 });
  });

  test("dual-timescale belief detects a recent change without erasing history", () => {
    const now = Date.now();
    const day = 86_400_000;
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `old-${i}`, profileSlug: "p", sourceId: `s-old-${i}`, dimension: "engagement" as const,
        value: .75, confidence: .9, reliability: .9,
        observedAt: new Date(now - (180 + i * 5) * day).toISOString(), rationale: "old",
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `new-${i}`, profileSlug: "p", sourceId: `s-new-${i}`, dimension: "engagement" as const,
        value: -.72, confidence: .9, reliability: .9,
        observedAt: new Date(now - (i + 1) * day).toISOString(), rationale: "new",
      })),
    ];
    const belief = stateEngine.buildBeliefs(rows).find((item) => item.dimension === "engagement")!;
    expect(belief.changing).toBe(true);
    expect(belief.shortTerm).toBeLessThan(belief.longTerm);
    expect(belief.evidenceCount).toBe(11);
  });

  test("planner generates alternatives, simulations, critics and a bounded choice", () => {
    const beliefs = stateEngine.buildBeliefs([]);
    const hypotheses = stateEngine.buildHypotheses(beliefs);
    const strategies = planner.generateStrategies("missing", "reply", "deep", beliefs, hypotheses, ["a", "b", "c"]);
    const simulations = planner.simulateStrategies(strategies, hypotheses, beliefs, "deep");
    const critics = planner.evaluateStrategies(strategies, simulations, [], false);
    const uncertainty = planner.assessUncertainty(beliefs, hypotheses, strategies, simulations, []);
    const selection = planner.selectStrategy(strategies, uncertainty);
    expect(strategies.length).toBeGreaterThanOrEqual(4);
    expect(simulations.length).toBeGreaterThanOrEqual(strategies.length * 2);
    expect(critics.length).toBe(strategies.length);
    expect(selection.selected).toBeTruthy();
    expect(uncertainty.abstain).toBe(true);
  });

  test("vertical slice links decisions to outcomes and survives event replay", async () => {
    const profile = store.createPartner("决策测试", 2, false);
    const report = await pipeline.runDecisionPipeline({
      profileSlug: profile.slug, partnerName: profile.name, stage: profile.stage,
      antiSimp: false, mode: "reply", planningMode: "balanced",
      text: "她说明天可能很累，但周末可以一起吃饭",
      evidence: [{
        id: "message:old", kind: "message", text: "上次她主动约了咖啡",
        observedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), reliability: .8, importance: .7,
      }],
    });
    expect(report.strategies.length).toBeGreaterThanOrEqual(3);
    expect(report.simulations.length).toBeGreaterThan(0);
    expect(decisionStore.getDecisionReport(profile.slug, report.id)?.id).toBe(report.id);

    decisionStore.recordLinkedOutcome(profile.slug, {
      decisionId: report.id, strategyId: report.selectedStrategy.id, replyId: report.replyId,
      replyText: "那周末一起吃饭？", outcome: "positive", responseDelayHours: 2,
      signals: { initiated: true, followedThrough: true },
    });
    const performance = decisionStore.strategyPerformance(profile.slug);
    expect(performance.totalOutcomes).toBe(1);
    expect(performance.strategies[0].family).toBe(report.selectedStrategy.family);

    decisionStore.recordTemporalFact({
      profileSlug: profile.slug, subject: "决策测试", predicate: "mentioned_plan",
      object: "周末见面", validFrom: new Date().toISOString(), confidence: .8,
      reliability: .8, sourceId: "fact-source-a",
    });
    decisionStore.recordTemporalFact({
      profileSlug: profile.slug, subject: "决策测试", predicate: "mentioned_plan",
      object: "周末不见", validFrom: new Date(Date.now() + 1000).toISOString(), confidence: .8,
      reliability: .8, sourceId: "fact-source-b",
    });
    const graph = decisionStore.evidenceGraph(profile.slug);
    expect(graph.nodes.length).toBeGreaterThan(4);
    expect(graph.edges.some((edge: any) => edge.relation === "contradicts")).toBe(true);

    const registered = decisionStore.syncPatternRegistry(profile.slug, [{
      id: "tested-pattern", label: "测试模式", support: 4, counterexamples: 1,
      confidence: .7, validated: true, explanation: "合成测试",
    }]);
    expect(registered.find((item: any) => item.id === "tested-pattern")?.lifecycle).toBe("active");
    expect(decisionStore.updatePatternLifecycle(profile.slug, "tested-pattern", "retired")?.lifecycle).toBe("retired");

    decisionStore.recordCalibrationExample(report, {
      decisionId: report.id, strategyId: report.selectedStrategy.id, replyId: report.replyId,
      replyText: "不得进入校准文件", partnerResponse: "也不得进入校准文件",
      outcome: "positive", responseDelayHours: 2,
    });
    const calibrationJson = JSON.stringify(decisionStore.calibrationDataset());
    expect(calibrationJson).not.toContain("不得进入校准文件");
    expect(calibrationJson).not.toContain(profile.slug);
    expect(decisionStore.calibrationReport().samples).toBe(1);
    expect(decisionStore.deleteCalibrationDataset()).toBe(1);
    const before = decisionStore.readObservations(profile.slug).length;
    const rebuilt = decisionStore.rebuildDerivedState(profile.slug);
    expect(rebuilt.events).toBeGreaterThan(4);
    expect(rebuilt.outcomes).toBe(1);
    expect(decisionStore.readObservations(profile.slug).length).toBe(before);
    const diagnostics = decisionStore.decisionDiagnostics(profile.slug) as any;
    expect(diagnostics.counts.decisions).toBe(1);
    expect(diagnostics.counts.outcomes).toBe(1);
  });

  test("offline synthetic evaluation avoids known unsafe strategy choices", () => {
    const result = evaluation.evaluateDecisionEngine("deep");
    expect(result.unsafeRate).toBeLessThanOrEqual(.2);
    expect(result.abstentionAccuracy).toBeGreaterThanOrEqual(.8);
  });
});

describe("learned world model", () => {
  const pressuredRows = ["emotional_pressure", "boundary_sensitivity"].flatMap((dimension) =>
    Array.from({ length: 4 }, (_, index) => ({
      id: `wm-${dimension}-${index}`, profileSlug: "wm", sourceId: `wm-s-${dimension}-${index}`,
      dimension: dimension as any, value: .8, confidence: .9, reliability: .9,
      observedAt: new Date(Date.now() - index * 86_400_000).toISOString(), rationale: "压力线索",
    })));

  test("regime-switching dynamics: advancing under pressure predicts worse outcomes than soothing", () => {
    const belief = worldmodel.beliefFromStates(stateEngine.buildBeliefs(pressuredRows));
    const invite = worldmodel.transition(belief, "invite", "pressured");
    const warm = worldmodel.transition(belief, "warm", "pressured");
    expect(invite.mean[DIM("emotional_pressure")]).toBeGreaterThan(warm.mean[DIM("emotional_pressure")]);
    const inviteResponses = worldmodel.responseDistribution(invite);
    const warmResponses = worldmodel.responseDistribution(warm);
    expect(warmResponses.negative).toBeLessThan(inviteResponses.negative);
    expect(warmResponses.positive).toBeGreaterThan(inviteResponses.positive);
  });

  test("imagined observations update the belief like a measurement", () => {
    const belief = { mean: new Float64Array(9), variance: new Float64Array(9).fill(.5) };
    const updated = worldmodel.observationUpdate(belief, "positive");
    expect(updated.mean[DIM("engagement")]).toBeGreaterThan(0);
    expect(updated.variance[DIM("engagement")]).toBeLessThan(.5);
    const ghosted = worldmodel.observationUpdate(belief, "no_reply");
    expect(ghosted.mean[DIM("engagement")]).toBeLessThan(0);
  });

  test("rollout branches expose calibrated response distributions and bounded values", () => {
    const beliefs = stateEngine.buildBeliefs([]);
    const hypotheses = stateEngine.buildHypotheses(beliefs);
    const strategies = planner.generateStrategies("wm-branches", "reply", "deep", beliefs, hypotheses, ["a", "b"]);
    const branches = planner.simulateStrategies(strategies, hypotheses, beliefs, "deep");
    for (const branch of branches) {
      const total = Object.values(branch.responseDistribution ?? {}).reduce((a, b) => a + b, 0);
      expect(Math.abs(total - 1)).toBeLessThan(1e-6);
      expect(branch.delayedReward).toBeGreaterThanOrEqual(0);
      expect(branch.delayedReward).toBeLessThanOrEqual(1);
      expect(branch.horizon).toBe(3);
      expect(branch.valueVariance).toBeGreaterThanOrEqual(0);
    }
  });

  test("EVOI: a clarifying question is worth more when hypotheses compete", () => {
    const beliefs = stateEngine.buildBeliefs([]);
    const uniform = stateEngine.buildHypotheses(beliefs);
    const peaked = uniform.map((hypothesis, index) => ({
      ...hypothesis, probability: index === 0 ? .91 : .03,
    }));
    const ambiguous = worldmodel.expectedValueOfInformation(beliefs, uniform, 3, "deep");
    const resolved = worldmodel.expectedValueOfInformation(beliefs, peaked, 3, "deep");
    expect(ambiguous).toBeGreaterThan(resolved);
  });

  test("recorded outcomes shift the learned response mixture and the gate", async () => {
    const profile = store.createPartner("世界模型学习", 2, false);
    const report = await pipeline.runDecisionPipeline({
      profileSlug: profile.slug, partnerName: profile.name, stage: profile.stage,
      antiSimp: false, mode: "reply", planningMode: "balanced",
      text: "她最近回复都很快，周末还主动提了一起去看展",
      evidence: [],
    });
    const at = new Date().toISOString();
    for (let i = 0; i < 4; i++) {
      decisionStore.updateWorldModel(profile.slug, report, {
        outcome: "no_reply", strategyId: report.selectedStrategy.id,
      }, at);
    }
    const snapshot = decisionStore.loadWorldModel(profile.slug);
    const key = `${report.hypotheses[0].id}:${report.selectedStrategy.family}`;
    expect(snapshot.entries[key]?.counts.no_reply).toBeGreaterThanOrEqual(3.9);
    expect(snapshot.gate.samples).toBeGreaterThanOrEqual(3.9);
    const belief = worldmodel.beliefFromStates(report.beliefs);
    const predicted = worldmodel.transition(belief, report.selectedStrategy.family, report.hypotheses[0].id, snapshot.entries[key]);
    const adjusted = worldmodel.responseDistribution(predicted, snapshot.entries[key]);
    const structural = worldmodel.responseDistribution(predicted);
    expect(adjusted.no_reply).toBeGreaterThan(structural.no_reply);
  });

  test("network trace mirrors the actual computation", () => {
    const beliefs = stateEngine.buildBeliefs(pressuredRows);
    const hypotheses = stateEngine.buildHypotheses(beliefs);
    const strategies = planner.generateStrategies("wm-trace", "reply", "deep", beliefs, hypotheses, []);
    const branches = planner.simulateStrategies(strategies, hypotheses, beliefs, "deep");
    const critics = planner.evaluateStrategies(strategies, branches, [], false);
    void critics;
    const uncertainty = planner.assessUncertainty(beliefs, hypotheses, strategies, branches, []);
    const selected = planner.selectStrategy(strategies, uncertainty).selected;
    const trace = worldmodel.buildNetworkTrace({
      states: beliefs, hypotheses, selected, branches, uncertainty,
    });
    expect(trace.layers.length).toBeGreaterThanOrEqual(6);
    expect(trace.edges.length).toBeGreaterThan(12);
    const pressureNode = trace.layers[0].nodes.find((n: any) => n.id === "b:emotional_pressure")!;
    expect(pressureNode.activation).toBeGreaterThan(.3);
    const regimeLayer = trace.layers.find((l: any) => l.id === "regimes")!;
    const total = regimeLayer.nodes.reduce((sum: number, n: any) => sum + n.activation, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-6);
    const ids = new Set(trace.layers.flatMap((l: any) => l.nodes.map((n: any) => n.id)));
    for (const edge of trace.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });

  test("boldness reshapes the objective monotonically", () => {
    expect(planner.rewardWeightsFor(.9).riskPenalty).toBeLessThan(planner.rewardWeightsFor(.1).riskPenalty);
    const beliefs = stateEngine.buildBeliefs([]);
    const hypotheses = stateEngine.buildHypotheses(beliefs);
    const timid = worldmodel.expectedValueOfInformation(beliefs, hypotheses, 3, "deep", undefined, .1);
    const bold = worldmodel.expectedValueOfInformation(beliefs, hypotheses, 3, "deep", undefined, .9);
    expect(bold).toBeLessThanOrEqual(timid);
    const stub = () => ({ mean: .5, samples: 0 });
    const boldInvite = planner.generateStrategies("bold", "reply", "deep", beliefs, hypotheses, [], [], stub, undefined, .95)
      .find((s: any) => s.family === "invite");
    const timidInvite = planner.generateStrategies("bold", "reply", "deep", beliefs, hypotheses, [], [], stub, undefined, .05)
      .find((s: any) => s.family === "invite");
    if (boldInvite && timidInvite) expect(boldInvite.score).toBeGreaterThan(timidInvite.score);
    else expect(Boolean(boldInvite)).toBe(true); // bold profile must at least consider inviting
  });

  test("hybrid retrieval ranks matches first and suppresses near-duplicates", () => {
    const base = { kind: "message" as const, observedAt: new Date().toISOString(), reliability: .8, importance: .6 };
    const items = [
      { ...base, id: "food-plan", text: "她说这周末想一起去吃饭" },
      { ...base, id: "band", text: "她喜欢的乐队下个月有演唱会" },
      { ...base, id: "food-plan-dup", text: "她说这周末想一起去吃饭呀" },
      { ...base, id: "work", text: "她最近项目加班比较多" },
    ];
    const selected = evidenceModule.retrieveEvidence("retrieval-test", "周末一起吃饭的邀约", items, 3);
    expect(selected[0].id).toBe("food-plan");
    expect(selected.some((item: any) => item.id === "food-plan-dup")).toBe(false);
  });
});
