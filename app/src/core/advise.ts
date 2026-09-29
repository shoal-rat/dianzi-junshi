/**
 * 跑一轮：扫梗 → 装配 → 流式生成 → 人话检查（能确定修的直接修，修不了的让军师改一轮）
 * → 落库 → 记兴趣读数、ta 的梗、素材索引。
 */

import { composeTurn } from "./compose";
import { demoAnswer } from "./demo";
import { scanMemes } from "./glossary";
import { voiceDoctrine } from "./doctrine";
import { appLang, chatLang } from "../store/locale";
import { autofix, lint } from "./voice";
import { normalizeAnswer, parseAnswer, planText } from "../shared/contract";
import { labels, SEAL_EN, type Lang, type MemeHit, type Mode, type PersonDTO, type PlanCheck, type TurnContext, type TurnDTO } from "../shared/domain";
import { completeJSON, modelName, ProviderError, streamText, type ProviderConfig } from "../llm";
import { createTurn, finishTurn, getTurn } from "../store/turns";
import { recordReading } from "../store/learning";
import { recordMemes } from "../store/dossier";
import { addArchive } from "../store/archive";
import { touchPerson } from "../store/people";
import type { StoredImage } from "../store/images";
import { msg } from "../store/messages";

export type TurnEvent =
  | { type: "turn"; turn: TurnDTO }
  | { type: "context"; context: TurnContext }
  | { type: "delta"; text: string }
  | { type: "status"; text: string }
  | { type: "replace"; output: string }
  | { type: "done"; turn: TurnDTO }
  | { type: "error"; message: string; hint?: string; turn?: TurnDTO };

/** 把第 n 个 reply 围栏的内容换掉。 */
export function replaceReply(output: string, n: number, text: string): string {
  let count = -1;
  return output.replace(/(^|\n)(\s*```reply[^\n]*\n)([\s\S]*?)(\n\s*```)/g, (all, lead, open, _body, close) => {
    count++;
    return count === n ? `${lead}${open}${text}${close}` : all;
  });
}

export function checksFor(output: string, lang: Lang = "zh"): { output: string; checks: PlanCheck[] } {
  const parsed = parseAnswer(output);
  let fixed = output;
  const checks: PlanCheck[] = [];
  parsed.plans.forEach((plan, i) => {
    const raw = planText(plan);
    const clean = autofix(raw, lang);
    if (clean !== raw && clean) fixed = replaceReply(fixed, i, clean);
    checks.push({ index: plan.index, seal: plan.seal, text: clean, lint: lint(clean, lang) });
  });
  return { output: fixed, checks };
}

const REVISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["revisions"],
  properties: {
    revisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "text"],
        properties: { index: { type: "integer" }, text: { type: "string" } },
      },
    },
  },
};

export async function revisePlans(cfg: ProviderConfig, workdir: string, context: string, items: Array<{ index: number; seal: string; text: string; problems: string[] }>, signal?: AbortSignal, lang: Lang = "zh"): Promise<Map<number, string>> {
  const en = lang === "en";
  const out = new Map<number, string>();
  if (!items.length) return out;
  const result = await completeJSON(cfg, {
    schemaName: "revisions",
    schema: REVISE_SCHEMA,
    system: [
      { text: voiceDoctrine(lang), cache: true },
      { text: en
        ? "You're Junshi's editor. Fix the texts below so they pass the vibe check: keep the meaning, direction and flirt level, change only what's flagged. At most 3 bubbles each, one per line, in natural English."
        : "你是电子军师的改稿手。把没过人话检查的几条微信回复改到能过：保住原来的意思、方向和撩的程度，只动出问题的地方。每条最多 3 个气泡，一行一个。", cache: false },
    ],
    user: en
      ? `Their side of the chat: ${context.slice(0, 600)}\n\nTexts to fix:\n${items.map((it) => `#${it.index} (${SEAL_EN[it.seal] ?? it.seal})\n${it.text}\nIssues: ${it.problems.join("; ")}`).join("\n\n")}\n\nReturn {"revisions":[{"index":number,"text":"fixed text, one bubble per line"}]}`
      : `对方那边的情况：${context.slice(0, 600)}\n\n要改的回复：\n${items.map((it) => `#${it.index}（${it.seal}）\n${it.text}\n问题：${it.problems.join("；")}`).join("\n\n")}\n\n返回 {"revisions":[{"index":序号,"text":"改好的回复，气泡之间用换行"}]}`,
    images: [],
    workdir,
    effort: "low",
    maxTokens: 2000,
    signal,
  }, (value) => {
    const list = (value as any)?.revisions;
    return Array.isArray(list) ? list : null;
  });
  for (const r of result as Array<{ index: number; text: string }>) {
    if (Number.isInteger(r.index) && typeof r.text === "string" && r.text.trim()) out.set(r.index, autofix(r.text, lang));
  }
  return out;
}

export async function* runTurn(opts: {
  person: PersonDTO;
  mode: Mode;
  text: string;
  images: StoredImage[];
  cfg: ProviderConfig;
  signal?: AbortSignal;
}): AsyncGenerator<TurnEvent> {
  const { person, mode, text, images, cfg, signal } = opts;
  const lang = chatLang(person);
  const memes: MemeHit[] = scanMemes(text, lang);
  const turn = createTurn({ personId: person.id, mode, text, imageIds: images.map((i) => i.id), memes, provider: cfg.kind, model: modelName(cfg) });
  yield { type: "turn", turn };

  let context: TurnContext = { lane: "daily", modules: [], facts: 0, recalled: [], tactics: 0, festivals: [] };
  let full = "";
  try {
    const composed = await composeTurn({ person, turnId: turn.id, mode, text, images, memes });
    context = composed.context;
    yield { type: "context", context };

    if (cfg.kind === "demo") {
      full = demoAnswer(mode, text, labels(lang).pronoun(person.gender), lang);
      for (const chunk of full.match(/[\s\S]{1,6}/g) ?? []) {
        if (signal?.aborted) break;
        yield { type: "delta", text: chunk };
        await Bun.sleep(8);
      }
    } else {
      for await (const chunk of streamText(cfg, { ...composed.request, signal })) {
        full += chunk;
        yield { type: "delta", text: chunk };
      }
    }
    if (signal?.aborted) {
      finishTurn(turn.id, { output: full, checks: [], context, status: full.trim() ? "done" : "error", error: full.trim() ? undefined : "中途停下了" });
      return;
    }
    if (!full.trim()) throw new ProviderError(msg().aiSilent);

    full = normalizeAnswer(full);
    let { output, checks } = checksFor(full, lang);
    const failing = checks.filter((c) => c.lint.result === "FAIL");
    if (failing.length && cfg.kind !== "demo") {
      yield { type: "status", text: appLang() === "en" ? `${failing.length} move${failing.length > 1 ? "s" : ""} failed the vibe check — fixing` : `有 ${failing.length} 条没过人话检查，军师在改…` };
      try {
        const judge = parseAnswer(output).judge;
        const fixes = await revisePlans(cfg, composed.request.workdir, [text, judge?.original, judge?.verdict].filter(Boolean).join(" / "),
          failing.map((c) => ({ index: c.index, seal: c.seal, text: c.text, problems: c.lint.findings.filter((f) => f.level === "FAIL").map((f) => `${f.text}: ${f.hint}`) })), signal, lang);
        const plans = parseAnswer(output).plans;
        for (const [index, fixedText] of fixes) {
          const pos = plans.findIndex((p) => p.index === index);
          if (pos >= 0) output = replaceReply(output, pos, fixedText);
        }
        const again = checksFor(output, lang);
        output = again.output;
        checks = again.checks.map((c) => {
          const before = failing.find((f) => f.index === c.index);
          if (!before) return c;
          const stuck = c.lint.result === "FAIL" ? c.lint.findings.find((f) => f.level === "FAIL")?.hint : undefined;
          return { ...c, revised: fixes.has(c.index), stuck };
        });
      } catch {
        checks = checks.map((c) => (c.lint.result === "FAIL" ? { ...c, stuck: c.lint.findings.find((f) => f.level === "FAIL")?.hint } : c));
      }
    }
    if (output !== full) yield { type: "replace", output };

    finishTurn(turn.id, { output, checks, context, status: "done" });
    const parsed = parseAnswer(output);
    recordReading(person.id, turn.id, parsed.judge?.interest, parsed.judge?.player);
    if (mode !== "polish") {
      recordMemes(person.id, memes);
      const original = parsed.judge?.original ?? "";
      const said = [text.trim(), original && !text.includes(original) ? (lang === "en" ? `(their last line in the screenshot: ${original})` : `（截图里 ta 的最后一句：${original}）`) : ""].filter(Boolean).join(" ");
      if (said) await addArchive(person.id, { kind: "turn", text: said, sourceId: turn.id });
    }
    touchPerson(person.id);
    yield { type: "done", turn: getTurn(turn.id)! };
  } catch (error: any) {
    if (signal?.aborted) return;
    const message = error instanceof ProviderError ? error.message : String(error?.message ?? error);
    finishTurn(turn.id, { output: full, checks: [], context, status: "error", error: message });
    yield { type: "error", message, hint: error instanceof ProviderError ? error.hint : undefined, turn: getTurn(turn.id) ?? undefined };
  }
}
