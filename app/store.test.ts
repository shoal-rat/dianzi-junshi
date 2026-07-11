import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const home = mkdtempSync(join(tmpdir(), "dianzi-junshi-test-"));
process.env.DIANZI_JUNSHI_HOME = home;
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

  test("semantic material retrieval can recover an important old screenshot", () => {
    const profile = store.createPartner("向量记忆", 1, false);
    for (let i = 0; i < 18; i++) {
      materials.indexMaterialMemory(profile.slug, {
        id: `recent-${i}.png`, fileName: `recent-${i}.png`, sourceName: `最近闲聊 ${i}`,
        mediaType: "image/png", createdAt: new Date(Date.now() - i * 86_400_000).toISOString(), provider: "test",
        summary: "普通的吃饭和天气闲聊", facts: ["聊到午饭"], keywords: ["日常", "吃饭"], people: [], dates: [],
        sentiment: "平常", importance: 0.2, retrievalText: "日常闲聊 午饭 吃饭 天气 普通聊天",
      });
    }
    materials.indexMaterialMemory(profile.slug, {
      id: "old-concert.png", fileName: "old-concert.png", sourceName: "两年前的聊天截图",
      mediaType: "image/png", createdAt: "2024-01-02T00:00:00.000Z", provider: "test",
      summary: "她提到很想去看一次现场演唱会", facts: ["明确说想看现场"], keywords: ["演唱会", "音乐节", "现场演出"],
      people: ["她"], dates: ["两年前"], sentiment: "期待", importance: 0.82,
      retrievalText: "演唱会 现场音乐 音乐节 live concert 想看的演出 约会偏好",
    });

    const found = materials.retrieveMaterialMemories(profile.slug, "她以前是不是说过想看演唱会", 4);
    expect(found[0]?.id).toBe("old-concert.png");
    expect(found[0]?.score).toBeGreaterThan(0.1);
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
