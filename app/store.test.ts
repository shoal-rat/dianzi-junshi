import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const home = mkdtempSync(join(tmpdir(), "dianzi-junshi-test-"));
process.env.DIANZI_JUNSHI_HOME = home;
process.env.DJ_DISABLE_SEMANTIC = "1";
const store = await import(`./store.ts?test=${Date.now()}`);
const materials = await import(`./materials.ts?test=${Date.now()}`);
const adaptive = await import("./adaptive.ts");

afterAll(() => {
  // Windows keeps SQLite files locked until the connection is explicitly closed.
  adaptive.resetAdaptiveDatabaseForTests();
  rmSync(home, { recursive: true, force: true });
});

describe("profile storage and context packing", () => {
  test("rejects profile path traversal", () => {
    expect(store.getPartner("../../outside")).toBeNull();
    expect(store.attachmentPath("../../outside", "x.png")).toBeNull();
  });

  test("never writes API keys into the JSON settings file", () => {
    store.writeSettings({ provider: "claude", providers: { claude: { apiKey: "secret-test-key", model: "test" } } });
    const raw = readFileSync(join(home, "config.json"), "utf8");
    expect(raw).not.toContain("secret-test-key");
    expect(JSON.parse(raw).providers.claude.hasKey).toBe(true);
    expect(store.activeProviderConfig().apiKey).toBe("secret-test-key");
  });

  test("keeps the full import while retrieving an older relevant chunk", () => {
    const profile = store.createPartner("测试对象", 1, false);
    const early = "我们第一次聊到演唱会，她说最想看现场。\n";
    const filler = Array.from({ length: 70 }, (_, i) => `这是第 ${i} 段普通背景。${"普通内容".repeat(90)}`).join("\n");
    store.importPartnerContext(profile.slug, early + filler, []);
    const all = store.readMessages(profile.slug, 10_000);
    const pack = store.buildContextPack(profile.slug, "她之前提过什么演唱会", 4, 3);

    expect(all.length).toBeGreaterThan(4);
    expect(pack.stats.omitted).toBeGreaterThan(0);
    expect(pack.messages.some((m: { text: string }) => m.text.includes("演唱会"))).toBe(true);
    expect(all.map((m: { text: string }) => m.text).join("\n")).toContain("第 69 段普通背景");
  });

  test("semantic material retrieval can recover an important old screenshot", async () => {
    const profile = store.createPartner("向量记忆", 1, false);
    for (let i = 0; i < 18; i++) {
      await materials.indexMaterialMemory(profile.slug, {
        id: `recent-${i}.png`, fileName: `recent-${i}.png`, sourceName: `最近闲聊 ${i}`,
        mediaType: "image/png", createdAt: new Date(Date.now() - i * 86_400_000).toISOString(), provider: "test",
        summary: "普通的吃饭和天气闲聊", facts: ["聊到午饭"], keywords: ["日常", "吃饭"], people: [], dates: [],
        sentiment: "平常", importance: 0.2, retrievalText: "日常闲聊 午饭 吃饭 天气 普通聊天",
      });
    }
    await materials.indexMaterialMemory(profile.slug, {
      id: "old-concert.png", fileName: "old-concert.png", sourceName: "两年前的聊天截图",
      mediaType: "image/png", createdAt: "2024-01-02T00:00:00.000Z", provider: "test",
      summary: "她提到很想去看一次现场演唱会", facts: ["明确说想看现场"], keywords: ["演唱会", "音乐节", "现场演出"],
      people: ["她"], dates: ["两年前"], sentiment: "期待", importance: 0.82,
      retrievalText: "演唱会 现场音乐 音乐节 live concert 想看的演出 约会偏好",
    });

    const found = await materials.retrieveMaterialMemories(profile.slug, "她以前是不是说过想看演唱会", 4);
    expect(found[0]?.id).toBe("old-concert.png");
    expect(found[0]?.score).toBeGreaterThan(0.1);
  });

  test("structured facts: normalization, legacy strings, type inference", () => {
    const facts = materials.normalizeFacts([
      "她说周五有空",
      { text: "她不喜欢吵的地方", type: "preference", confidence: 0.9 },
      { text: "", confidence: 1 },
      { text: "我们说好下周见", confidence: 0.8 },
    ], { observedAt: "2026-07-10", sourceImage: "a.png" });
    expect(facts.length).toBe(3);
    expect(facts[0].type).toBe("one_time");
    expect(facts[0].sourceImage).toBe("a.png");
    expect(facts[1].type).toBe("preference");
    expect(facts[2].type).toBe("agreement");
  });

  test("two-stage retrieval diversifies and reports reasons", async () => {
    const profile = store.createPartner("检索测试", 1, false);
    for (let i = 0; i < 3; i++) {
      await materials.indexMaterialMemory(profile.slug, {
        id: `dup-${i}.png`, fileName: `dup-${i}.png`, sourceName: `火锅重复 ${i}`,
        mediaType: "image/png", createdAt: new Date().toISOString(), provider: "test",
        summary: "她说周六想一起去吃火锅", facts: [{ id: `f-${i}`, text: "周六想吃火锅", type: "one_time", confidence: .9, status: "active" }],
        keywords: ["火锅", "周六"], people: ["她"], dates: ["周六"], sentiment: "期待", importance: 0.6,
        retrievalText: "周六 火锅 一起吃 邀约",
      });
    }
    await materials.indexMaterialMemory(profile.slug, {
      id: "movie.png", fileName: "movie.png", sourceName: "电影计划",
      mediaType: "image/png", createdAt: new Date().toISOString(), provider: "test",
      summary: "她提到最近想看某部新电影", facts: [{ id: "fm", text: "想看新电影", type: "preference", confidence: .8, status: "active" }],
      keywords: ["电影"], people: ["她"], dates: [], sentiment: "期待", importance: 0.5,
      retrievalText: "电影 想看 新片",
    });
    const result = await materials.retrieveMaterialMemoriesDetailed(profile.slug, "她周六想吃什么", 6);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].reason).toContain("命中");
    // MMR: the three near-identical hotpot cards must not all take slots.
    const hotpot = result.items.filter((x: any) => x.id.startsWith("dup-"));
    expect(hotpot.length).toBeLessThanOrEqual(2);
    expect(["factual", "date", "general", "person"]).toContain(result.trace.queryType);
  });

  test("superseded facts stop steering retrieval; usage is logged", async () => {
    const profile = store.createPartner("事实冲突", 1, false);
    await materials.indexMaterialMemory(profile.slug, {
      id: "old.png", fileName: "old.png", sourceName: "旧约定",
      mediaType: "image/png", createdAt: "2026-05-01T00:00:00.000Z", provider: "test",
      summary: "她说周五有空可以见面", facts: [{ id: "old-f", text: "她周五有空", type: "availability", confidence: .8, status: "active" }],
      keywords: ["周五"], people: ["她"], dates: ["周五"], sentiment: "积极", importance: 0.6,
      retrievalText: "周五 有空 见面",
    });
    await materials.indexMaterialMemory(profile.slug, {
      id: "new.png", fileName: "new.png", sourceName: "改口",
      mediaType: "image/png", createdAt: "2026-06-01T00:00:00.000Z", provider: "test",
      summary: "她说周五没空了改周日", facts: [{ id: "new-f", text: "她周五没空", type: "availability", confidence: .85, status: "active" }],
      keywords: ["周五"], people: ["她"], dates: ["周五"], sentiment: "中性", importance: 0.6,
      retrievalText: "周五 没空 改周日",
    });
    const center = await materials.memoryCenterData(profile.slug);
    const old = center.memories.find((m: any) => m.id === "old.png");
    expect(old?.facts[0].status).not.toBe("active");
    const found = await materials.retrieveMaterialMemories(profile.slug, "她周五到底有没有空", 6);
    expect(found.length).toBeGreaterThan(0);
    const refreshed = await materials.memoryCenterData(profile.slug);
    expect(refreshed.memories.some((m: any) => (m.retrievalCount ?? 0) > 0)).toBe(true);
  });

  test("event aggregation clusters adjacent screenshots and keeps source links", async () => {
    const profile = store.createPartner("事件聚合", 1, false);
    const shots = [
      { id: "e1.png", summary: "她提议周六一起去看展", text: "周六 看展 提议 一起去 美术馆" },
      { id: "e2.png", summary: "她确认周六下午两点", text: "周六 下午两点 确认 时间 看展" },
      { id: "e3.png", summary: "看展之后一起吃了饭很开心", text: "看展 之后 吃饭 开心 结束" },
    ];
    const ids = [];
    for (const shot of shots) {
      const memory = await materials.indexMaterialMemory(profile.slug, {
        id: shot.id, fileName: shot.id, sourceName: shot.id, mediaType: "image/png",
        createdAt: new Date().toISOString(), provider: "test", summary: shot.summary,
        facts: [{ id: `${shot.id}-f`, text: shot.summary, type: "one_time", confidence: .8, status: "active" }],
        keywords: ["看展"], people: ["她"], dates: ["周六"], sentiment: "积极", importance: 0.7,
        retrievalText: shot.text,
      });
      ids.push(memory.id);
    }
    const events = materials.aggregateEventsForJob(profile.slug, ids);
    expect(events.length).toBe(1);
    expect(events[0].sourceMemoryIds.length).toBe(3);
    expect(events[0].eventType).toBe("meeting");
  });

  test("memory center edits deactivate and delete", async () => {
    const profile = store.createPartner("记忆管理", 1, false);
    await materials.indexMaterialMemory(profile.slug, {
      id: "m.png", fileName: "m.png", sourceName: "一条记忆", mediaType: "image/png",
      createdAt: new Date().toISOString(), provider: "test", summary: "普通记忆",
      facts: [{ id: "mf", text: "一条事实", type: "observation", confidence: .7, status: "active" }],
      keywords: [], people: [], dates: [], sentiment: "平常", importance: 0.4, retrievalText: "普通记忆 一条事实",
    });
    expect(materials.updateMemoryEntry(profile.slug, "m.png", { status: "retired" })).toBe(true);
    let center = await materials.memoryCenterData(profile.slug);
    expect(center.memories.find((m: any) => m.id === "m.png")?.status).toBe("retired");
    expect(materials.deleteMemoryEntry(profile.slug, "m.png")).toBe(true);
    center = await materials.memoryCenterData(profile.slug);
    expect(center.memories.some((m: any) => m.id === "m.png")).toBe(false);
  });

  test("temporal profile notices when recent behavior diverges from the long term", () => {
    const profile = store.createPartner("变化画像", 2, false);
    const day = 86_400_000;
    for (let i = 0; i < 6; i++) {
      adaptive.recordOutcomeFeedback(profile.slug, {
        replyText: "周末一起吃饭？", outcome: "positive", signals: { followedThrough: true },
        observedAt: new Date(Date.now() - (190 + i * 8) * day).toISOString(),
      });
    }
    for (let i = 0; i < 4; i++) {
      adaptive.recordOutcomeFeedback(profile.slug, {
        replyText: "这周还见吗？", outcome: "negative", signals: { brokePromise: true },
        observedAt: new Date(Date.now() - (i + 1) * day).toISOString(),
      });
    }
    const snapshot = adaptive.getAdaptiveProfile(profile.slug);
    const followThrough = snapshot.traits.find((trait) => trait.key === "follow_through");
    expect(followThrough?.changing).toBe(true);
    expect(followThrough!.shortTerm).toBeLessThan(followThrough!.longTerm);
    expect(snapshot.actionEvidenceWeight).toBeGreaterThan(snapshot.responseEvidenceWeight);
  });
});
