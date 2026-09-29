import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { database, HOME, kvGet } from "../src/store/db";
import { createPerson, deletePerson, getPerson, listPeople, updatePerson } from "../src/store/people";
import { addFacts, dossierForPrompt, effectiveStatus, listFacts, listMemes, recordMemes, updateFact } from "../src/store/dossier";
import { addArchive, chunkText, recall } from "../src/store/archive";
import { learningForPrompt, readings, recordOutcome, recordReading, styleProfile, tacticStats, workedAndFlopped } from "../src/store/learning";
import { saveImage, sniffImage } from "../src/store/images";
import { createTurn, finishTurn, listTurns, markCopied, recentForPrompt } from "../src/store/turns";
import { migrateLegacy } from "../src/store/legacy";
import { readSettings, resetSettingsMemo, writeSettings } from "../src/store/settings";
import { composeTurn } from "../src/core/compose";
import { tokens, similarity } from "../src/store/tokenize";

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

describe("人和对话", () => {
  test("建、改、删；删的时候连带全部数据", () => {
    const p = createPerson({ name: "  阿杰  ", stage: 9, nerve: -3 });
    expect(p.name).toBe("阿杰");
    expect(p.stage).toBe(7);
    expect(p.nerve).toBe(0);
    const q = updatePerson(p.id, { nerve: 4, clearEyed: true });
    expect(q.nerve).toBe(4);
    expect(q.clearEyed).toBe(true);
    addFacts(p.id, [{ slot: "like", text: "喜欢猫" }], "user");
    deletePerson(p.id);
    expect(getPerson(p.id)).toBeNull();
    expect((database().query("SELECT COUNT(*) AS n FROM facts WHERE person_id=?").get(p.id) as any).n).toBe(0);
  });

  test("截图按文件头识别、同图去重", () => {
    const p = createPerson({ name: "图" });
    expect(sniffImage(PNG)).toBe("image/png");
    expect(() => saveImage(p.id, new TextEncoder().encode("not an image"), "x.png", "turn")).toThrow();
    const a = saveImage(p.id, PNG, "a.png", "turn");
    const b = saveImage(p.id, PNG, "b.png", "import");
    expect(b.id).toBe(a.id);
    expect(b.duplicate).toBe(true);
  });

  test("最近几轮摘要带上用户复制了哪条、后来怎样", () => {
    const p = createPerson({ name: "摘要" });
    const t = createTurn({ personId: p.id, mode: "reply", text: "周六见吗", imageIds: [], memes: [], provider: "demo" });
    finishTurn(t.id, { output: "```judge\n判断：她在约你\n```\n### 稳 · 答应 · 油0\n```reply\n好啊\n```\n### 撩 · 逗 · 油1\n```reply\n见你还用问\n```\n推荐：撩｜可以", checks: [], context: { lane: "邀约", modules: [], facts: 0, recalled: [], tactics: 0, festivals: [] }, status: "done" });
    markCopied(t.id, 1);
    recordOutcome(p.id, { turnId: t.id, planIndex: 1, seal: "撩", sent: "见你还用问", result: "good", reply: "哈哈哈哈 那说定了" });
    const next = createTurn({ personId: p.id, mode: "reply", text: "新的一句", imageIds: [], memes: [], provider: "demo" });
    const recent = recentForPrompt(p.id, next.id);
    expect(recent.text).toContain("周六见吗");
    expect(recent.text).toContain("她在约你");
    expect(recent.text).toContain("用户复制了「撩」");
    expect(recent.text).toContain("接住了");
    expect(listTurns(p.id).length).toBe(2);
  });
});

describe("档案卡", () => {
  test("同类事实合并计数、基本栏新值覆盖旧值、用户写的不被自动覆盖", () => {
    const p = createPerson({ name: "档案" });
    addFacts(p.id, [{ slot: "diet", text: "不吃香菜" }], "screenshot");
    addFacts(p.id, [{ slot: "忌口", text: "不吃香菜；上次还挑掉了" }], "screenshot");
    let facts = listFacts(p.id, false);
    expect(facts.filter((f) => f.slot === "diet").length).toBe(1);
    expect(facts.find((f) => f.slot === "diet")!.seen).toBe(2);

    addFacts(p.id, [{ slot: "basic", text: "城市：上海" }], "screenshot");
    addFacts(p.id, [{ slot: "basic", text: "城市：杭州" }], "screenshot");
    facts = listFacts(p.id);
    expect(facts.find((f) => f.text === "城市：上海")!.status).toBe("superseded");
    expect(facts.find((f) => f.text === "城市：杭州")!.status).toBe("active");

    addFacts(p.id, [{ slot: "basic", text: "生日：10月12日" }], "user", undefined, 0.95);
    addFacts(p.id, [{ slot: "basic", text: "生日：下周三" }], "screenshot");
    facts = listFacts(p.id, false);
    expect(facts.some((f) => f.text === "生日：10月12日")).toBe(true);
    expect(facts.some((f) => f.text === "生日：下周三")).toBe(false);
  });

  test("安排会过期，钉住的不会，持久属性不会", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    expect(effectiveStatus({ slot: "plan", status: "active", date: null, created_at: old, pinned: 0 })).toBe("expired");
    expect(effectiveStatus({ slot: "plan", status: "active", date: null, created_at: old, pinned: 1 })).toBe("active");
    expect(effectiveStatus({ slot: "plan", status: "active", date: "2020-01-01", created_at: new Date().toISOString(), pinned: 0 })).toBe("expired");
    expect(effectiveStatus({ slot: "basic", status: "active", date: null, created_at: old, pinned: 0 })).toBe("active");
  });

  test("给军师的版本：按栏目分组，生日算进 ta 的日子", () => {
    const p = createPerson({ name: "日子" });
    addFacts(p.id, [{ slot: "basic", text: "生日：10月12日" }, { slot: "like", text: "喜欢看海" }], "user", undefined, 0.95);
    const d = dossierForPrompt(p.id, new Date(2026, 8, 29));
    expect(d.text).toContain("【基本】");
    expect(d.text).toContain("喜欢看海");
    expect(d.dates[0].label).toBe("ta 的生日");
    const f = listFacts(p.id).find((x) => x.slot === "like")!;
    updateFact(p.id, f.id, { status: "removed" });
    expect(dossierForPrompt(p.id).text).not.toContain("喜欢看海");
  });

  test("ta 的梗记忆：计数，日常化的词不记", () => {
    const p = createPerson({ name: "梗" });
    recordMemes(p.id, [{ term: "那咋了", meaning: "嘴硬", status: "鲜活" }, { term: "破防", meaning: "", status: "日常化" }]);
    recordMemes(p.id, [{ term: "那咋了", meaning: "嘴硬", status: "鲜活" }]);
    const m = listMemes(p.id);
    expect(m.map((x) => [x.term, x.count])).toEqual([["那咋了", 2]]);
  });
});

describe("素材库", () => {
  test("分词：词典分词 + 二元组", () => {
    const t = tokens("周六那家店订到位子了");
    expect(t).toContain("周六");
    expect(t).toContain("位子");
    expect(similarity("不吃香菜", "不吃香菜！")).toBeGreaterThan(0.8);
  });

  test("长文本按行切块", () => {
    const text = Array.from({ length: 50 }, (_, i) => `第${i}行：今天聊到了一些事情`).join("\n");
    const chunks = chunkText(text, 200);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 220)).toBe(true);
  });

  test("按当前问题找回很久以前的资料，并说明理由", async () => {
    const p = createPerson({ name: "检索" });
    await addArchive(p.id, { kind: "paste", text: "她说下个月想去看海，最好是厦门", happenedAt: "2025-01-01T00:00:00Z" });
    await addArchive(p.id, { kind: "paste", text: "今天公司团建吃了烤肉" });
    await addArchive(p.id, { kind: "screenshot", text: "她发了一张猫的照片，说猫又胖了" });
    const hits = await recall(p.id, "上次她说想去哪看海来着", { limit: 2 });
    expect(hits[0].text).toContain("看海");
    expect(hits[0].why).toContain("看海");
  });
});

describe("从结果里学", () => {
  test("战绩、接住的说法、聊冷的原句、用户风格", () => {
    const p = createPerson({ name: "学习" });
    recordOutcome(p.id, { seal: "撩", suggested: "今天好想你啊！", sent: "有点想你", result: "good" });
    recordOutcome(p.id, { seal: "撩", suggested: "你今天真好看！", sent: "今天挺好看", result: "good" });
    recordOutcome(p.id, { seal: "稳", sent: "早点休息", result: "cold" });
    recordOutcome(p.id, { seal: "奇", sent: "周六一起看展吗", result: "ghosted" });
    const stats = tacticStats(p.id);
    expect(stats.map((s) => [s.seal, s.tries, s.good])).toEqual([["稳", 1, 0], ["撩", 2, 2], ["奇", 1, 0]]);
    const { worked, flopped } = workedAndFlopped(p.id);
    expect(worked.length).toBe(2);
    expect(flopped.map((f) => f.text)).toEqual(["周六一起看展吗", "早点休息"]);
    const style = styleProfile(p.id);
    expect(style.samples).toBe(4);
    expect(style.habits).toContain("基本不打标点");
    expect(style.habits).toContain("会删掉感叹号");
    const text = learningForPrompt(p.id).tactics;
    expect(text).toContain("聊冷了");
    expect(text).toContain("早点休息");
  });

  test("兴趣读数按时间排", () => {
    const p = createPerson({ name: "走势" });
    recordReading(p.id, "t1", { overall: 4, action: 2 }, 50);
    recordReading(p.id, "t2", { overall: 6 }, undefined);
    recordReading(p.id, "t3", undefined, undefined);
    expect(readings(p.id).map((r) => r.overall)).toEqual([4, 6]);
  });
});

describe("装配一轮", () => {
  test("档案、打法、日期、找回的资料都进系统提示，问答策略在前且可缓存", async () => {
    const p = createPerson({ name: "装配", stage: 1, nerve: 3, clearEyed: true });
    addFacts(p.id, [{ slot: "diet", text: "不吃香菜" }], "user", undefined, 0.95);
    recordOutcome(p.id, { seal: "稳", sent: "早点休息", result: "cold" });
    await addArchive(p.id, { kind: "paste", text: "她说周六想去吃火锅" });
    const turn = createTurn({ personId: p.id, mode: "reply", text: "周六吃啥", imageIds: [], memes: [], provider: "demo" });
    const c = await composeTurn({ person: getPerson(p.id)!, turnId: turn.id, mode: "reply", text: "周六吃啥", images: [], memes: [], at: new Date(2026, 8, 29, 21) });
    const sys = c.request.system;
    expect(sys[0].text).toContain("电子军师");
    expect(sys.slice(0, -1).every((s) => s.cache)).toBe(true);
    const dyn = sys[sys.length - 1].text;
    expect(dyn).toContain("2026年9月29日 周二 晚上");
    expect(dyn).toContain("国庆");
    expect(dyn).toContain("本次上限 2");
    expect(dyn).toContain("偏敢");
    expect(dyn).toContain("不吃香菜");
    expect(dyn).toContain("早点休息");
    expect(dyn).toContain("周六想去吃火锅");
    expect(c.lane).toBe("邀约");
    expect(c.context.modules).toContain("dating");
    expect(c.request.user).toContain("【怎么回】");
  });
});

describe("设置与搬家", () => {
  test("v5 的 config.json 迁成 settings.json，Key 标记保留", () => {
    writeFileSync(join(HOME, "config.json"), JSON.stringify({ provider: "codex", providers: { claude: { model: "claude-sonnet-5", hasKey: true }, deepseek: { model: "deepseek-chat" } } }));
    try { require("node:fs").rmSync(join(HOME, "settings.json")); } catch { /* 首次 */ }
    resetSettingsMemo();
    const s = readSettings();
    expect(s.provider).toBe("codex");
    expect(s.providers.claude?.hasKey).toBe(true);
    expect(s.providers.claude?.model).toBeUndefined();
    expect(s.depth).toBe("fast");
    writeSettings({ depth: "deep" });
    resetSettingsMemo();
    expect(readSettings().depth).toBe("deep");
  });

  test("v5 的档案目录搬进新数据库，只搬一次", async () => {
    const dir = join(HOME, "partners", "xiaomei");
    mkdirSync(join(dir, "imports"), { recursive: true });
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ slug: "xiaomei", name: "小美", stage: 2, antiSimp: true, boldness: 0.75, notes: "同事" }));
    writeFileSync(join(dir, "imports", "a.png"), PNG);
    writeFileSync(join(dir, "messages.jsonl"), [
      { role: "user", mode: "context", text: "她说她是天蝎座", ts: "2026-07-01T10:00:00Z" },
      { role: "partner", mode: "reply", text: "那咋了", attachments: [{ fileName: "a.png", name: "a.png" }], ts: "2026-07-02T10:00:00Z" },
      { role: "junshi", mode: "reply", text: "### 方案1 · 稳妥（油0.5/5）\n```reply\n没咋\n```", ts: "2026-07-02T10:00:05Z" },
    ].map((m) => JSON.stringify(m)).join("\n"));
    expect(await migrateLegacy()).toBe(1);
    expect(await migrateLegacy()).toBe(0);
    const p = listPeople().find((x) => x.name === "小美")!;
    expect(p.stage).toBe(2);
    expect(p.nerve).toBe(3);
    expect(p.clearEyed).toBe(true);
    const turns = listTurns(p.id);
    expect(turns.length).toBe(1);
    expect(turns[0].input).toBe("那咋了");
    expect(turns[0].images.length).toBe(1);
    expect(kvGet("legacy:xiaomei")).toBeTruthy();
    expect((await recall(p.id, "她是什么星座来着 天蝎座吗")).length).toBeGreaterThan(0);
  });
});
