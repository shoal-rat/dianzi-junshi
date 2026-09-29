/**
 * 男生追女生、女生追男生、没写性别——同一套军师都要接得住。
 * 这里的样本刻意男女各半。
 */

import { describe, expect, test } from "bun:test";
import { composeTurn } from "../src/core/compose";
import { demoAnswer } from "../src/core/demo";
import { routeLane, type Lane } from "../src/core/doctrine";
import { scanMemes } from "../src/core/glossary";
import { lint } from "../src/core/voice";
import { parseAnswer } from "../src/shared/contract";
import { pronounOf } from "../src/shared/domain";
import { createPerson, getPerson, updatePerson } from "../src/store/people";
import { addFacts, dossierForPrompt } from "../src/store/dossier";
import { recordOutcome, styleProfile, tacticStats } from "../src/store/learning";
import { createTurn } from "../src/store/turns";
import { resetSettingsMemo, writeSettings } from "../src/store/settings";

async function dynamicPrompt(gender: string, me: string, text: string) {
  writeSettings({ me });
  resetSettingsMemo();
  const p = createPerson({ name: `样本${gender || "x"}${me || "x"}`, gender, stage: 1 });
  const turn = createTurn({ personId: p.id, mode: "reply", text, imageIds: [], memes: [], provider: "demo" });
  const c = await composeTurn({ person: getPerson(p.id)!, turnId: turn.id, mode: "reply", text, images: [], memes: scanMemes(text) });
  return c.request.system[c.request.system.length - 1].text;
}

describe("性别写进档案和提示词", () => {
  test("女生问男生：称「他」，打法看追男生", async () => {
    const dyn = await dynamicPrompt("m", "f", "他说周末去打球 问我要不要去看");
    expect(dyn).toContain("ta 是男生，称「他」");
    expect(dyn).toContain("用户是女生");
    expect(dyn).toContain("追男生");
  });

  test("男生问女生：称「她」，打法看追女生", async () => {
    const dyn = await dynamicPrompt("f", "m", "她说今天加班好累");
    expect(dyn).toContain("ta 是女生，称「她」");
    expect(dyn).toContain("用户是男生");
    expect(dyn).toContain("追女生");
  });

  test("都没写：一律称 ta，让军师自己看聊天", async () => {
    const dyn = await dynamicPrompt("", "", "在干嘛");
    expect(dyn).toContain("称「ta」");
    expect(dyn).toContain("用户性别没写");
    expect(dyn).not.toContain("追男生");
    expect(dyn).not.toContain("追女生");
  });

  test("同性也行：两边都写同一个性别", async () => {
    const dyn = await dynamicPrompt("m", "m", "他问我今晚要不要出去喝一杯");
    expect(dyn).toContain("ta 是男生");
    expect(dyn).toContain("用户是男生");
  });

  test("改档案的性别、非法值归零", () => {
    const p = createPerson({ name: "改性别", gender: "x" });
    expect(p.gender).toBe("");
    expect(updatePerson(p.id, { gender: "f" }).gender).toBe("f");
    expect(pronounOf("m")).toBe("他");
    expect(pronounOf("")).toBe("ta");
  });
});

describe("示范回答跟着代词走", () => {
  test("男生对象：示范里没有「她」", () => {
    for (const mode of ["reply", "read", "polish", "odds"] as const) {
      const out = demoAnswer(mode, "周六那家店我订好了 别放我鸽子", "他");
      expect(out).not.toContain("她");
      expect(parseAnswer(out).judge?.verdict).toBeTruthy();
    }
    expect(demoAnswer("reply", "周六别放我鸽子", "他")).toContain("他");
  });

  test("没写性别：用 ta", () => {
    expect(demoAnswer("odds", "x", "ta")).toContain("ta");
  });
});

describe("男生、女生说的话都能分对车道", () => {
  const cases: Array<[string, Lane]> = [
    ["他说周末去打球 问我要不要去看", "invite"],
    ["她说周六想去看展", "invite"],
    ["他已读不回两天了", "pushpull"],
    ["她好几天没理我了", "pushpull"],
    ["他今天加班到十一点 说好累", "emotion"],
    ["她说最近压力好大 失眠", "emotion"],
    ["他问我你是不是生气了", "conflict"],
    ["她说算了 随便你", "conflict"],
  ];
  for (const [text, lane] of cases) test(text, () => expect(routeLane(text, 0)).toBe(lane));

  test("梗不分男女：男生常用的梗也扫得到", () => {
    expect(scanMemes("兄弟我今天红温了 那咋了").map((h) => h.matched)).toEqual(["红温", "那咋了"]);
    expect(scanMemes("蚌埠住了 我还没想好穿啥").map((h) => h.matched)).toEqual(["蚌埠住了"]);
  });
});

describe("人话门禁对男女一视同仁", () => {
  test("对女生的土味开场、对男生的土味开场都拦", () => {
    expect(lint("美女你好 交个朋友").result).toBe("FAIL");
    expect(lint("帅哥你好 交个朋友").result).toBe("FAIL");
    expect(lint("小仙女今天好看").result).toBe("FAIL");
  });

  test("女生口吻、男生口吻的正常回复都能过", () => {
    expect(lint("好滴 那周六见\n我提前到").result).toBe("PASS");
    expect(lint("行 周六我来订\n挑好了发你").result).toBe("PASS");
  });
});

describe("档案和学习：男性对象同样适用", () => {
  test("男生的事实、战绩、女生用户的说话风格", () => {
    const p = createPerson({ name: "阿杰", gender: "m", stage: 2 });
    addFacts(p.id, [
      { slot: "like", text: "喜欢打篮球" },
      { slot: "habit", text: "周四晚上固定开黑" },
      { slot: "basic", text: "生日：3月8日" },
    ], "user", undefined, 0.95);
    const d = dossierForPrompt(p.id, new Date(2027, 1, 20));
    expect(d.text).toContain("喜欢打篮球");
    expect(d.dates[0].label).toBe("ta 的生日");

    recordOutcome(p.id, { seal: "撩", suggested: "你打球的样子还挺帅！", sent: "打球还挺帅嘛", result: "good" });
    recordOutcome(p.id, { seal: "奇", suggested: "周六一起看比赛吗！", sent: "周六一起看比赛吗", result: "good" });
    recordOutcome(p.id, { seal: "稳", sent: "那你早点休息", result: "cold" });
    expect(tacticStats(p.id).find((s) => s.seal === "撩")?.good).toBe(1);
    const style = styleProfile(p.id);
    expect(style.samples).toBe(3);
    expect(style.habits).toContain("会删掉感叹号");
  });
});
