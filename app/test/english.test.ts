/**
 * 英文版：英文契约、英文人话检查、英文梗词典、两套问答策略互不串味、语言检测。
 * 测试默认按中文系统跑（setup.ts 里 DJ_LANG=zh），英文用例靠档案的 lang 或设置里的 language。
 */

import { describe, expect, test } from "bun:test";
import { composeTurn } from "../src/core/compose";
import { demoAnswer } from "../src/core/demo";
import { doctrineFor, routeLane } from "../src/core/doctrine";
import { GLOSSARY_EN, scanMemes } from "../src/core/glossary";
import { autofix, lint } from "../src/core/voice";
import { upcomingFestivals } from "../src/core/calendar";
import { parseAnswer } from "../src/shared/contract";
import { labels, laneLabel } from "../src/shared/domain";
import { createPerson, getPerson, updatePerson } from "../src/store/people";
import { createTurn } from "../src/store/turns";
import { detectSystemLang, langFromTag, chatLang, appLang } from "../src/store/locale";
import { readSettings, resetSettingsMemo, writeSettings } from "../src/store/settings";
import { msg } from "../src/store/messages";
import { CATALOGS } from "../web/lib/i18n";

const CJK = /[㐀-鿿]/;

const EN_REPLY = `\`\`\`judge
Verdict: She's joking about being doomed — play along, don't fix it
Note: cooked | slang for "doomed", not literal
Last line: "lowkey I'm cooked"
Interest: sweet 6 initiative 5 commitment 3 follow-through 4 overall 5 confidence med
Player: 20
Pursuit: slow burn
\`\`\`

### Steady · join the bit · thirst 0.5
\`\`\`reply
respectfully you were cooked the second you hit snooze
\`\`\`
Plays along, keeps it easy.

### Flirt · tease with a hook · thirst 1.5
\`\`\`reply
tragic
guess I'll have to supervise your mornings
\`\`\`
The hook is in the joke.

### Wildcard · same energy back · thirst 1
\`\`\`reply
we're both cooked
\`\`\`
Mirroring is safest.

Pick: Flirt | she opened the door with a joke
Don't send: you should set two alarms | turns a joke into a lecture
Hold off: asking her out | wait until she's off work

\`\`\`gif
Search: "this is fine dog"
When: after her reply
\`\`\`
`;

describe("English contract", () => {
  test("judge, plans, pick, avoid, hold and gif all parse", () => {
    const p = parseAnswer(EN_REPLY);
    expect(p.judge?.verdict).toContain("joking");
    expect(p.judge?.notes[0]).toEqual({ quote: "cooked", note: 'slang for "doomed", not literal' });
    expect(p.judge?.original).toBe("lowkey I'm cooked");
    expect(p.judge?.interest).toMatchObject({ sweet: 6, initiative: 5, commitment: 3, action: 4, overall: 5, confidence: "med" });
    expect(p.judge?.player).toBe(20);
    expect(p.judge?.pursuit).toBe("slow burn");
    expect(p.plans.map((x) => x.seal)).toEqual(["稳", "撩", "奇"]);
    expect(p.plans[1].title).toBe("tease with a hook");
    expect(p.plans[1].oil).toBe(1.5);
    expect(p.plans[1].lines).toEqual(["tragic", "guess I'll have to supervise your mornings"]);
    expect(p.pick).toMatchObject({ seal: "撩" });
    const kinds = p.segments.map((s) => s.type);
    expect(kinds).toContain("avoid");
    expect(kinds).toContain("hold");
    expect(p.segments.some((s) => s.type === "kv" && s.kind === "sticker")).toBe(true);
  });

  test("verdict block keeps English keys", () => {
    const p = parseAnswer("```verdict\nCall: Tweak it\nFit: 6\nThirst: 2.5 (cap 1.5)\nNeediness: med\n```");
    const kv = p.segments.find((s) => s.type === "kv");
    expect(kv && kv.type === "kv" && kv.kind).toBe("verdict");
    expect(kv && kv.type === "kv" && kv.rows[0]).toEqual(["Call", "Tweak it"]);
  });
});

describe("English vibe check", () => {
  test("natural texts pass", () => {
    for (const t of ["wait that's actually so funny", "ok but hear me out\ntacos after?", "lol no way"]) {
      expect(lint(t, "en").result).toBe("PASS");
    }
  });

  test("periods, dead slang, lectures, booty calls and essays fail", () => {
    expect(lint("Sounds good.", "en").result).toBe("FAIL");
    expect(lint("that's so on fleek", "en").findings.some((f) => f.check === "dated")).toBe(true);
    expect(lint("YOLO lets go", "en").result).toBe("FAIL");
    expect(lint("u up", "en").result).toBe("FAIL");
    expect(lint("you should really get more sleep", "en").findings.length).toBeGreaterThan(0);
    const essay = "I just wanted to say that I really enjoyed talking to you yesterday and I think we should definitely do it again sometime soon because it was fun";
    expect(lint(essay, "en").result).toBe("FAIL");
  });

  test("🙂 and 😂 warn, stacked !! warns", () => {
    expect(lint("sure 🙂", "en").findings.some((f) => f.text === "🙂")).toBe(true);
    expect(lint("haha 😂", "en").warnCount).toBeGreaterThan(0);
    expect(lint("omg yes!!", "en").findings.some((f) => f.check === "bang")).toBe(true);
  });

  test("autofix drops the trailing period only", () => {
    expect(autofix("sounds good.", "en")).toBe("sounds good");
    expect(autofix("see you at 8 p.m.", "en")).toBe("see you at 8 p.m.");
  });

  test("Chinese rules don't leak into English lint and vice versa", () => {
    expect(lint("先别硬撑，喝口水歇会儿。", "zh").result).toBe("FAIL");
    expect(lint("冷死了吧今天\n给你点杯热的？", "zh").result).toBe("PASS");
  });
});

describe("English slang glossary", () => {
  test("case-insensitive, whole words only", () => {
    expect(scanMemes("LOWKEY this is rent free", "en").map((h) => h.matched.toLowerCase())).toEqual(["lowkey", "rent free"]);
    expect(scanMemes("the rizzler strikes again", "en").map((h) => h.term)).toEqual(["rizzler"]);
    expect(scanMemes("that's delulu", "en")[0].term).toBe("delulu");
  });

  test("ambiguous everyday words are not flagged as slang", () => {
    expect(scanMemes("I cooked dinner and it was fire", "en")).toEqual([]);
    expect(scanMemes("bet you can't guess where I am", "en").some((h) => h.term === "bet")).toBe(false);
  });

  test("dead list comes from section D", () => {
    for (const t of ["on fleek", "YOLO", "bae", "squad goals", "very demure"]) expect(GLOSSARY_EN.banned).toContain(t);
    expect(GLOSSARY_EN.banned).not.toContain("delulu");
  });
});

describe("English lanes and calendar", () => {
  test("routes by content, weekday mentions alone aren't an invite", () => {
    expect(routeLane("my boss added a 4pm meeting on a friday", 0, "en")).toBe("daily");
    expect(routeLane("are you free this saturday?", 0, "en")).toBe("invite");
    expect(routeLane("he left me on read again", 0, "en")).toBe("pushpull");
    expect(routeLane("are you mad at me", 0, "en")).toBe("conflict");
    expect(routeLane("rough day honestly", 0, "en")).toBe("emotion");
    expect(routeLane("so mid", 1, "en")).toBe("meme");
    expect(laneLabel("pushpull", "en")).toBe("mixed signals");
  });

  test("English calendar has Western dates, not 七夕", () => {
    const names = upcomingFestivals(new Date("2026-02-01T12:00:00"), 20, "en").map((f) => f.name);
    expect(names).toContain("Valentine's Day");
    expect(names.join(" ")).not.toMatch(CJK);
  });
});

describe("doctrine sets never mix", () => {
  test("English doctrine has no Chinese strategy text", () => {
    const blocks = doctrineFor({ mode: "reply", lane: "invite", hasImages: true, nearFestival: true, lang: "en" });
    expect(blocks.map((b) => b.name)).toEqual(["core", "voice", "memes", "reading", "strategy", "dating", "profile"]);
    for (const b of blocks) {
      expect(b.text.startsWith(`<!-- en/${b.name}.md -->`)).toBe(true);
      // 印章字（稳 / 撩 / 奇）以外不该有中文
      expect(b.text.replace(/[稳撩奇荐]/g, "")).not.toMatch(/[一-鿿]{2,}/);
    }
  });

  test("an English chat loads only the English set; a Chinese chat only the Chinese set", async () => {
    const en = createPerson({ name: "Jordan", gender: "f", lang: "en", stage: 1 });
    const t1 = createTurn({ personId: en.id, mode: "reply", text: "lowkey I'm cooked", imageIds: [], memes: [], provider: "demo" });
    const c1 = await composeTurn({ person: getPerson(en.id)!, turnId: t1.id, mode: "reply", text: "lowkey I'm cooked", images: [], memes: scanMemes("lowkey I'm cooked", "en") });
    const sys1 = c1.request.system.map((s) => s.text).join("\n");
    expect(c1.lang).toBe("en");
    expect(c1.context.lang).toBe("en");
    expect(sys1).toContain("<!-- en/core.md -->");
    expect(sys1).not.toContain("<!-- core.md -->");
    expect(sys1).toContain("Gender: they're a woman");
    expect(c1.request.user.startsWith("[Reply]")).toBe(true);
    // 测试环境界面是中文 → 多一行跨语言说明，只有这一段
    expect(sys1).toContain("# Language\nThe user reads Chinese.");

    const zh = createPerson({ name: "小周", gender: "m", lang: "zh", stage: 1 });
    const t2 = createTurn({ personId: zh.id, mode: "reply", text: "下班了", imageIds: [], memes: [], provider: "demo" });
    const c2 = await composeTurn({ person: getPerson(zh.id)!, turnId: t2.id, mode: "reply", text: "下班了", images: [], memes: [] });
    const sys2 = c2.request.system.map((s) => s.text).join("\n");
    expect(sys2).toContain("<!-- core.md -->");
    expect(sys2).not.toContain("<!-- en/");
    expect(sys2).not.toContain("# Language");
    expect(sys2).not.toContain("Reality check");
  });

  test("person language follows the app when unset, and can be switched", () => {
    const p = createPerson({ name: "Sam", gender: "" });
    expect(p.lang).toBe("");
    expect(chatLang(p)).toBe(appLang());
    expect(updatePerson(p.id, { lang: "en" }).lang).toBe("en");
    expect(updatePerson(p.id, { lang: "klingon" }).lang).toBe("");
  });
});

describe("English demo and labels, both genders", () => {
  test("pronouns and verb agreement", () => {
    for (const pronoun of ["she", "he", "they"]) {
      const out = demoAnswer("odds", "been texting for two weeks", pronoun, "en");
      expect(out).not.toMatch(CJK);
      expect(out).not.toMatch(/\b(she|he) (care|reply|text)\b/);
      expect(parseAnswer(out).judge?.verdict).toBeTruthy();
    }
    const reply = demoAnswer("reply", "lowkey I'm cooked", "she", "en");
    expect(parseAnswer(reply).plans).toHaveLength(3);
    for (const plan of parseAnswer(reply).plans) expect(lint(plan.lines.join("\n"), "en").result).toBe("PASS");
  });

  test("English labels exist for every stage, nerve and gender", () => {
    const L = labels("en");
    for (let i = 0; i <= 7; i++) expect(L.stage(i).name).not.toMatch(CJK);
    for (let i = 0; i <= 4; i++) expect(L.nerve(i).brief).not.toMatch(CJK);
    expect([L.pronoun("f"), L.pronoun("m"), L.pronoun("")]).toEqual(["she", "he", "they"]);
  });
});

describe("language detection and catalogs", () => {
  test("locale tags", () => {
    expect(langFromTag("zh_CN.UTF-8")).toBe("zh");
    expect(langFromTag('"zh-Hans-US",')).toBe("zh");
    expect(langFromTag("en_GB.UTF-8")).toBe("en");
    expect(langFromTag("C")).toBeNull();
    expect(langFromTag("POSIX")).toBeNull();
  });

  test("LANG / LC_* on Linux, English fallback", () => {
    expect(detectSystemLang({ LANG: "zh_CN.UTF-8" }, "linux")).toBe("zh");
    expect(detectSystemLang({ LC_ALL: "en_US.UTF-8", LANG: "zh_CN.UTF-8" }, "linux")).toBe("en");
    expect(detectSystemLang({ LC_MESSAGES: "zh_TW.UTF-8", LANG: "C" }, "linux")).toBe("zh");
    expect(detectSystemLang({ LANGUAGE: "zh_CN:en", LANG: "C" }, "linux")).toBe("zh");
    expect(detectSystemLang({ DJ_LANG: "en", LANG: "zh_CN.UTF-8" }, "linux")).toBe("en");
    expect(detectSystemLang({ LANG: "de_DE.UTF-8" }, "linux")).toBe("en");
  });

  test("setting overrides the system; legacy settings stay Chinese", () => {
    writeSettings({ language: "en" });
    resetSettingsMemo();
    expect(appLang()).toBe("en");
    expect(msg().nameRequired).not.toMatch(CJK);
    writeSettings({ language: "auto" });
    resetSettingsMemo();
    expect(readSettings().language).toBe("auto");
    expect(appLang()).toBe("zh");
  });

  test("server messages: same keys in both languages", () => {
    const zh = msg("zh") as Record<string, unknown>;
    const en = msg("en") as Record<string, unknown>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const [k, v] of Object.entries(en)) {
      const s = typeof v === "function" ? String((v as (...a: unknown[]) => unknown)(1, 2)) : String(v);
      if (k !== "labelCustom") expect(s).not.toMatch(CJK);
    }
  });

  test("UI catalog: English has no stray Chinese except seals and the 中文 option", () => {
    const allowed = new Set(["welcomeVert", "welcomeStepSeals", "welcomeFootnote", "pickSeal", "inUse", "chatLangs", "uiLangs", "langBadge", "sealWord", "sealCaption", "verdictKeys"]);
    expect(Object.keys(CATALOGS.en).sort()).toEqual(Object.keys(CATALOGS.zh).sort());
    for (const [k, v] of Object.entries(CATALOGS.en)) {
      if (allowed.has(k)) continue;
      const s = typeof v === "function" ? JSON.stringify((v as (...a: unknown[]) => unknown)("ab", 2, 3, 4)) : JSON.stringify(v);
      expect(`${k}: ${s}`).not.toMatch(CJK);
    }
  });
});
