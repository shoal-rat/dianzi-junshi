import { describe, expect, test } from "bun:test";
import { normalizeAnswer, parseAnswer, parseInterest } from "../src/shared/contract";
import { replaceReply, checksFor } from "../src/core/advise";
import { demoAnswer } from "../src/core/demo";

const FULL = `\`\`\`judge
判断：她在撒娇嘴硬，等你接梗
批：那咋了｜俏皮地硬刚，不是生气
批：哈哈｜两个哈是缓冲
表面：睡到中午
情绪：放松——在玩
需要：被逗——看你怎么接
阶段：暧昧期（她主动分享作息）
兴趣：甜度8 主动7 承诺2 行动6 总体7 置信中
海王：25
追法：爱接梗 · 拉扯0
气质：偏痞
\`\`\`

### 稳 · 认怂接梗 · 油0.5
\`\`\`reply
没咋 羡慕的声音大了点
\`\`\`
秒怂加自嘲，话题续命。

### 撩 · 顺梗埋钩 · 油1.5
\`\`\`reply
挺好 记住了
以后约你只敢约下午场
\`\`\`
「以后会约你」藏在玩笑里。

### 奇 · 同款回敬 · 油1
\`\`\`reply
那咋了 我也爱赖床
\`\`\`
镜像她的句式。

推荐：奇｜镜像最安全
别这样回：睡懒觉对身体不好｜一句话杀死一个梗

\`\`\`strategy
回复间隔：现在回
拉扯动作：留钩子
\`\`\``;

describe("输出契约解析", () => {
  test("完整回答：读局、三个锦囊、推荐、避坑、军令", () => {
    const p = parseAnswer(FULL);
    expect(p.judge?.verdict).toBe("她在撒娇嘴硬，等你接梗");
    expect(p.judge?.notes).toEqual([
      { quote: "那咋了", note: "俏皮地硬刚，不是生气" },
      { quote: "哈哈", note: "两个哈是缓冲" },
    ]);
    expect(p.judge?.interest).toEqual({ sweet: 8, initiative: 7, commitment: 2, action: 6, overall: 7, confidence: "中" });
    expect(p.judge?.player).toBe(25);
    expect(p.plans.map((x) => [x.seal, x.title, x.oil, x.lines.length])).toEqual([
      ["稳", "认怂接梗", 0.5, 1],
      ["撩", "顺梗埋钩", 1.5, 2],
      ["奇", "同款回敬", 1, 1],
    ]);
    expect(p.plans[1].why).toBe("「以后会约你」藏在玩笑里。");
    expect(p.pick).toEqual({ seal: "奇", why: "镜像最安全" });
    const avoid = p.segments.find((s) => s.type === "avoid");
    expect(avoid).toEqual({ type: "avoid", text: "睡懒觉对身体不好", why: "一句话杀死一个梗" });
    const kv = p.segments.find((s) => s.type === "kv");
    expect(kv && kv.type === "kv" && kv.kind).toBe("strategy");
  });

  test("流式到一半：没闭合的围栏标记为 open，照样能画", () => {
    const half = FULL.slice(0, FULL.indexOf("以后约你"));
    const p = parseAnswer(half);
    expect(p.plans.length).toBe(2);
    expect(p.plans[1].open).toBe(true);
    expect(p.plans[1].lines).toEqual(["挺好 记住了"]);
    expect(p.judge?.open).toBe(false);
  });

  test("旧格式（方案N · 名称（油X/5））也认", () => {
    const p = parseAnswer("### 方案1 · 稳妥（油0.5/5）\n```reply\n懂了\n```\n\n### 方案2 · 会撩（油1.5/5）\n```reply\n行啊\n```\n推荐方案2：留了钩子");
    expect(p.plans.map((x) => [x.seal, x.oil])).toEqual([["稳", 0.5], ["撩", 1.5]]);
    expect(p.pick?.seal).toBe("撩");
  });

  test("围栏接在一句话后面、开头带过程播报：拆开并丢掉播报", () => {
    const raw = "我先看清最后一句。```judge\n判断：好\n```\n### 稳 · 接住 · 油0\n```reply\n行\n```";
    expect(normalizeAnswer(raw)).toContain("。\n```judge");
    const p = parseAnswer(raw);
    expect(p.segments[0].type).toBe("judge");
    expect(p.plans[0].lines).toEqual(["行"]);
  });

  test("兴趣行宽松解析", () => {
    expect(parseInterest("甜度 6 主动 4 承诺 3 行动 2 → 总体 5（置信低）")).toEqual({ sweet: 6, initiative: 4, commitment: 3, action: 2, overall: 5, confidence: "低" });
  });

  test("演示回答都符合契约", () => {
    for (const [mode, text] of [["reply", "那咋了"], ["reply", "周六别放我鸽子"], ["reply", "好累"], ["read", "x"], ["polish", "x"], ["odds", "x"]] as const) {
      const p = parseAnswer(demoAnswer(mode, text));
      expect(p.judge?.verdict?.length).toBeGreaterThan(5);
      if (mode === "reply") expect(p.plans.length).toBe(3);
    }
  });
});

describe("改写与自动修", () => {
  test("replaceReply 只换第 n 个 reply 围栏", () => {
    const out = replaceReply(FULL, 1, "新的一句");
    const p = parseAnswer(out);
    expect(p.plans[1].lines).toEqual(["新的一句"]);
    expect(p.plans[0].lines).toEqual(["没咋 羡慕的声音大了点"]);
    expect(p.plans[2].lines).toEqual(["那咋了 我也爱赖床"]);
  });

  test("checksFor 顺手去掉句尾句号，并逐条人话检查", () => {
    const raw = FULL.replace("没咋 羡慕的声音大了点", "没咋 羡慕的声音大了点。").replace("那咋了 我也爱赖床", "多喝热水");
    const { output, checks } = checksFor(raw);
    expect(parseAnswer(output).plans[0].lines).toEqual(["没咋 羡慕的声音大了点"]);
    expect(checks[0].lint.result).toBe("PASS");
    expect(checks[2].lint.result).toBe("FAIL");
  });
});
