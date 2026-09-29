import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Seal, Brush } from "./Seal";
import { PlanCard } from "./Plan";
import { Markdown } from "../lib/md";
import { kvGet, parseAnswer, type Judge, type Parsed, type Plan, type Segment } from "../../src/shared/contract";
import { oilCap, type Mode, type PersonDTO, type TurnDTO } from "../../src/shared/domain";
import type { Live } from "../lib/store";

function Meter({ label, value, max = 10, tone = "ink" }: { label: string; value?: number; max?: number; tone?: string }) {
  if (value === undefined) return null;
  return (
    <div class="meter" data-tone={tone}>
      <span>{label}</span>
      <i><b style={`width:${Math.max(3, (value / max) * 100)}%`} /></i>
      <em>{value}</em>
    </div>
  );
}

function PlayerGauge({ value }: { value?: number }) {
  if (value === undefined) return null;
  const band = value <= 20 ? "很低" : value <= 40 ? "偏低" : value <= 60 ? "中等" : value <= 80 ? "偏高" : "很高";
  return (
    <div class="player" style={`--v:${value}`}>
      <div class="player-top"><span>海王指数</span><b>{value}</b><em>{band}</em></div>
      <div class="player-bar"><i /></div>
    </div>
  );
}

export function JudgeCard({ judge, mode, streaming }: { judge: Judge; mode: Mode; streaming: boolean }) {
  const rich = Boolean(judge.surface || judge.emotion || judge.need || judge.interest || judge.player !== undefined || judge.stage || judge.pursuit);
  const [open, setOpen] = useState(mode !== "reply");
  return (
    <section class="judge">
      <div class="judge-head">
        <h3 class="judge-verdict">{judge.verdict ?? (streaming ? "…" : "")}</h3>
      </div>
      {rich && (
        <>
          {!open && <button class="judge-more" onClick={() => setOpen(true)}>展开读局</button>}
          {open && (
            <div class="judge-body">
              {(judge.surface || judge.emotion || judge.need) && (
                <dl class="layers">
                  {judge.surface && <div><dt>表面</dt><dd>{judge.surface}</dd></div>}
                  {judge.emotion && <div><dt>情绪</dt><dd>{judge.emotion}</dd></div>}
                  {judge.need && <div><dt>需要</dt><dd>{judge.need}</dd></div>}
                </dl>
              )}
              {(judge.interest || judge.player !== undefined) && (
                <div class="odds">
                  {judge.interest && (
                    <div class="interest">
                      <div class="interest-big"><b>{judge.interest.overall ?? "–"}</b><span>/10 兴趣{judge.interest.confidence ? ` · 置信${judge.interest.confidence}` : ""}</span></div>
                      <Meter label="甜度" value={judge.interest.sweet} />
                      <Meter label="主动" value={judge.interest.initiative} />
                      <Meter label="承诺" value={judge.interest.commitment} />
                      <Meter label="行动" value={judge.interest.action} tone="zhu" />
                    </div>
                  )}
                  <PlayerGauge value={judge.player} />
                </div>
              )}
              <div class="judge-chips">
                {judge.stage && <span><i>阶段</i>{judge.stage}</span>}
                {judge.pursuit && <span><i>追法</i>{judge.pursuit}</span>}
                {judge.vibe && <span><i>气质</i>{judge.vibe}</span>}
                {judge.extra.map(([k, v]) => <span key={k}><i>{k}</i>{v}</span>)}
              </div>
              {mode === "reply" && <button class="judge-more" onClick={() => setOpen(false)}>收起</button>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const KV_META: Record<string, { seal: string; title: string; tone: "zhu" | "ink" | "dai" | "jade" | "ochre" }> = {
  strategy: { seal: "令", title: "军令", tone: "ink" },
  aside: { seal: "注", title: "旁白 · 只给你看", tone: "dai" },
  sticker: { seal: "图", title: "表情包建议", tone: "dai" },
  stop: { seal: "醒", title: "清醒一下", tone: "zhu" },
};

function KVCard({ kind, rows }: { kind: string; rows: Array<[string, string]> }) {
  const meta = KV_META[kind];
  if (!meta || !rows.length) return null;
  if (kind === "strategy") {
    return (
      <section class="order">
        <header><Seal char="令" size={26} tone="ink" tilt={-4} /><b>军令</b></header>
        <div class="order-grid">
          {rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
      </section>
    );
  }
  return (
    <section class={`kv kv-${kind}`}>
      <header><Seal char={meta.seal} size={24} tone={meta.tone} tilt={-3} /><b>{meta.title}</b></header>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

const VERDICT_SEAL: Record<string, [string, "jade" | "ochre" | "zhu"]> = { 可以说: ["可", "jade"], 需要调整: ["改", "ochre"], 不建议: ["否", "zhu"] };

function VerdictCard({ rows, cap }: { rows: Array<[string, string]>; cap: number }) {
  const conclusion = kvGet(rows, "结论") ?? "";
  const [char, tone] = VERDICT_SEAL[conclusion] ?? ["评", "ink"];
  const num = (k: string) => { const v = kvGet(rows, k); const m = v?.match(/\d+(\.\d+)?/); return m ? Number(m[0]) : undefined; };
  return (
    <section class={`verdict tone-${tone}`}>
      <Seal char={char} size={64} tone={tone} tilt={-6} class="verdict-seal" />
      <div class="verdict-body">
        <h3>{conclusion || "评估"}</h3>
        <div class="verdict-meters">
          <Meter label="适配" value={num("适配")} />
          <Meter label="油腻" value={num("油腻")} max={5} tone={(num("油腻") ?? 0) > cap ? "zhu" : "ink"} />
        </div>
        <dl>
          {rows.filter(([k]) => !["结论", "适配", "油腻"].includes(k)).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </div>
    </section>
  );
}

type Group = { type: "plans"; plans: Plan[] } | Segment;

function group(segments: Segment[]): Group[] {
  const out: Group[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (s.type === "plan") {
      if (last && last.type === "plans") last.plans.push(s.plan);
      else out.push({ type: "plans", plans: [s.plan] });
    } else out.push(s);
  }
  return out;
}

export function Thinking({ live }: { live: Live }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(t); }, []);
  const sec = Math.floor((Date.now() - live.startedAt) / 1000);
  const phase = live.status ?? (!live.context ? "在翻档案" : live.firstTokenAt ? "在写" : live.context.modules.includes("profile") ? "在看截图、想打法" : "在想打法");
  return (
    <div class="thinking" aria-live="polite">
      <span class="ink-drop" />
      <span>军师{phase}…</span>
      <em>{sec}s</em>
      {live.context && !live.firstTokenAt && (
        <small>
          {live.context.facts ? `带上 ${live.context.facts} 条档案` : "档案还是空的"}
          {live.context.recalled.length ? ` · 找回 ${live.context.recalled.length} 条旧资料` : ""}
          {live.context.festivals.length ? ` · 临近${live.context.festivals[0]}` : ""}
        </small>
      )}
    </div>
  );
}

export function Answer({ turn, person, live }: { turn: TurnDTO; person: PersonDTO; live?: Live | null }) {
  const streaming = Boolean(live);
  const output = live ? live.output : turn.output;
  const parsed: Parsed = parseAnswer(output);
  const cap = oilCap(person.stage, person.nerve);
  const pick = parsed.pick?.seal;
  const nodes: ComponentChildren[] = [];
  group(parsed.segments).forEach((g, i) => {
    if (g.type === "judge") nodes.push(<JudgeCard key={i} judge={g.judge} mode={turn.mode} streaming={streaming} />);
    else if (g.type === "plans") {
      nodes.push(
        <div key={i} class={`plans n${g.plans.length}`}>
          {g.plans.map((p) => (
            <PlanCard key={p.index} plan={p} turn={turn} check={turn.checks.find((c) => c.index === p.index)}
              recommended={!streaming && pick === p.seal} cap={cap} streaming={streaming} />
          ))}
        </div>,
      );
    } else if (g.type === "pick") {
      nodes.push(<p key={i} class="pick"><Seal char="荐" size={22} variant="line" tilt={-6} /><b>{g.seal}</b><span>{g.why}</span></p>);
    } else if (g.type === "avoid") {
      nodes.push(<p key={i} class="avoid"><span class="avoid-mark">别这样回</span><s>{g.text}</s>{g.why && <span class="avoid-why">{g.why}</span>}</p>);
    } else if (g.type === "hold") {
      nodes.push(<p key={i} class="avoid hold"><span class="avoid-mark">暂时别说</span><span>{g.text}</span>{g.why && <span class="avoid-why">{g.why}</span>}</p>);
    } else if (g.type === "kv") {
      nodes.push(g.kind === "verdict" ? <VerdictCard key={i} rows={g.rows} cap={cap} /> : <KVCard key={i} kind={g.kind} rows={g.rows} />);
    } else if (g.type === "md") {
      nodes.push(<Markdown key={i} text={g.text} />);
    }
  });
  return (
    <div class={`answer ${streaming ? "streaming" : ""}`}>
      {streaming && !output && live && <Thinking live={live} />}
      {nodes}
      {streaming && output && live?.status && <Thinking live={live} />}
      {turn.status === "error" && !streaming && (
        <div class="answer-error">
          <Seal char="误" size={24} tone="zhu" />
          <span>{turn.error ?? "这次没成功"}</span>
        </div>
      )}
      {!streaming && parsed.segments.length > 0 && <Brush width={56} class="answer-end" />}
    </div>
  );
}
