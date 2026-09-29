import { describe, expect, test } from "bun:test";
import { GLOSSARY, scanMemes, termMatchers } from "../src/core/glossary";
import { autofix, lint } from "../src/core/voice";
import { doctrineFor, routeLane } from "../src/core/doctrine";
import { daysBetween, nextAnnual, upcomingFestivals } from "../src/core/calendar";
import { nerveOf, oilCap } from "../src/shared/domain";
import coreMd from "../../references/core.md" with { type: "text" };

describe("梗词典", () => {
  test("词条拆分：多写法、XX 句式、括号说明、单字不匹配", () => {
    expect(termMatchers("蚌埠住了 / 绷不住了")).toEqual(["蚌埠住了", "绷不住了"]);
    expect(termMatchers("拼好X")).toEqual(["拼好"]);
    expect(termMatchers("偷感（很重）")).toEqual(["偷感"]);
    expect(termMatchers("典 / 孝 / 急")).toEqual([]);
  });

  test("黑名单直接来自 D 区，描述性条目不进黑名单", () => {
    for (const t of ["绝绝子", "YYDS", "泰裤辣", "栓Q", "呵呵", "在吗", "奥利给"]) expect(GLOSSARY.banned).toContain(t);
    for (const t of GLOSSARY.banned) {
      expect(t.length).toBeGreaterThanOrEqual(2);
      expect(t).not.toMatch(/XX|以外|滥用/);
    }
    expect(GLOSSARY.shaky).toContain("city不city");
  });

  test("扫梗：长词优先、不重叠、按出现顺序", () => {
    const hits = scanMemes("那咋了 我就爱睡 笑死 你今天班味好重");
    expect(hits.map((h) => h.matched)).toEqual(["那咋了", "笑死", "班味"]);
    expect(hits[0].tone).toContain("不是生气");
    expect(scanMemes("偶尔也想出去玩")).toEqual([]);
  });
});

describe("人话门禁", () => {
  test("老规矩：长辈腔必挂，年轻人说法必过", () => {
    expect(lint("先别硬撑，喝口水歇会儿。").result).toBe("FAIL");
    expect(lint("冷死了吧今天\n给你点杯热的？").result).toBe("PASS");
  });

  test("过气梗、说教、超长都拦", () => {
    const r = lint("你应该早点睡\n绝绝子");
    const checks = r.findings.map((f) => f.check);
    expect(checks).toContain("lecture");
    expect(checks).toContain("elder");
    expect(checks).toContain("dated");
    expect(lint("这是一句非常非常长的回复用来测试超过三十六个字的气泡会不会被拦下来因为真的太长了吧").result).toBe("FAIL");
  });

  test("autofix 只修确定的：句尾句号、连发感叹号", () => {
    expect(autofix("好的。\n太好了！！！\n\n行")).toBe("好的\n太好了！\n行");
  });
});

describe("装配", () => {
  test("车道分诊", () => {
    expect(routeLane("周六那家店我们订到位子啦，别放我鸽子", 0)).toBe("邀约");
    expect(routeLane("她已读不回好几天了", 0)).toBe("拉扯");
    expect(routeLane("今天加班好累", 0)).toBe("情绪");
    expect(routeLane("那咋了", 1)).toBe("玩梗");
  });

  test("问答策略：核心 + 语感 + 梗 + 读局 + 打法常驻，约会和读人按需加", () => {
    const base = doctrineFor({ mode: "reply", lane: "日常", hasImages: false, nearFestival: false }).map((d) => d.name);
    expect(base).toEqual(["core", "voice", "memes", "reading", "strategy"]);
    const more = doctrineFor({ mode: "reply", lane: "邀约", hasImages: true, nearFestival: false }).map((d) => d.name);
    expect(more).toEqual([...base, "dating", "profile"]);
  });

  test("核心提示以正面指令为主：站用户这边、敢下判断", () => {
    const core = coreMd as unknown as string;
    expect(core).toContain("永远站在用户这边");
    expect(core).toContain("判断要敢下");
    // 不堆「不要 / 别 / 禁止」：整份核心里这类字眼控制在个位数
    const bans = core.match(/不要|禁止|不许|不得|绝不/g) ?? [];
    expect(bans.length).toBeLessThanOrEqual(3);
  });

  test("胆量调整油腻上限，夹在 0-5", () => {
    expect(oilCap(1, 2)).toBe(1.5);
    expect(oilCap(1, 4)).toBe(2.5);
    expect(oilCap(0, 0)).toBe(0);
    expect(oilCap(4, 4)).toBe(4.5);
    expect(nerveOf(9).name).toBe("放胆冲");
  });
});

describe("日历", () => {
  test("临近节日：国庆前两天、农历中秋", () => {
    const now = new Date(2026, 8, 29, 22, 0);
    const names = upcomingFestivals(now, 21).map((f) => `${f.name}:${f.days}`);
    expect(names).toContain("国庆:2");
    const mid = upcomingFestivals(new Date(2027, 8, 1), 21).map((f) => f.name);
    expect(mid).toContain("中秋");
  });

  test("生日换算到下一次", () => {
    const d = nextAnnual("生日：10月12日", new Date(2026, 8, 29))!;
    expect(daysBetween(new Date(2026, 8, 29), d)).toBe(13);
    const past = nextAnnual("生日 3/5", new Date(2026, 8, 29))!;
    expect(past.getFullYear()).toBe(2027);
  });
});
