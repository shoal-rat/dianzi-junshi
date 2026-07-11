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
