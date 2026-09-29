import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Seal, Brush } from "./Seal";
import { PlanCard } from "./Plan";
import { Markdown } from "../lib/md";
import { kvGet, parseAnswer, type Judge, type Parsed, type Plan, type Segment } from "../../src/shared/contract";
import { oilCap, SEAL_EN, type Mode, type PersonDTO, type TurnDTO } from "../../src/shared/domain";
import type { Live } from "../lib/store";
import { T, uiLang } from "../lib/i18n";

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
  const t = T();
  const band = t.playerBands[value <= 20 ? 0 : value <= 40 ? 1 : value <= 60 ? 2 : value <= 80 ? 3 : 4];
  return (
    <div class="player" style={`--v:${value}`}>
      <div class="player-top"><span>{t.playerIndex}</span><b>{value}</b><em>{band}</em></div>
      <div class="player-bar"><i /></div>
    </div>
  );
}

export function JudgeCard({ judge, mode, streaming }: { judge: Judge; mode: Mode; streaming: boolean }) {
  const rich = Boolean(judge.surface || judge.emotion || judge.need || judge.interest || judge.player !== undefined || judge.stage || judge.pursuit);
  const [open, setOpen] = useState(mode !== "reply");
  const t = T();
  const en = uiLang() === "en";
  return (
    <section class="judge">
      <div class="judge-head">
        <h3 class="judge-verdict">{judge.verdict ?? (streaming ? "…" : "")}</h3>
      </div>
      {rich && (
        <>
          {!open && <button class="judge-more" onClick={() => setOpen(true)}>{t.expandRead}</button>}
          {open && (
            <div class="judge-body">
              {(judge.surface || judge.emotion || judge.need) && (
                <dl class="layers">
                  {judge.surface && <div><dt>{en ? "On the surface" : "表面"}</dt><dd>{judge.surface}</dd></div>}
                  {judge.emotion && <div><dt>{en ? "Feeling" : "情绪"}</dt><dd>{judge.emotion}</dd></div>}
                  {judge.need && <div><dt>{en ? "What they want" : "需要"}</dt><dd>{judge.need}</dd></div>}
                </dl>
              )}
              {(judge.interest || judge.player !== undefined) && (
                <div class="odds">
                  {judge.interest && (
                    <div class="interest">
                      <div class="interest-big"><b>{judge.interest.overall ?? "–"}</b><span>/10 {t.interest}{judge.interest.confidence ? t.confidence(en ? ({ 高: "high", 中: "med", 低: "low" } as Record<string, string>)[judge.interest.confidence] ?? judge.interest.confidence : judge.interest.confidence) : ""}</span></div>
                      <Meter label={t.meters.sweet} value={judge.interest.sweet} />
                      <Meter label={t.meters.initiative} value={judge.interest.initiative} />
                      <Meter label={t.meters.commitment} value={judge.interest.commitment} />
                      <Meter label={t.meters.action} value={judge.interest.action} tone="zhu" />
                    </div>
                  )}
                  <PlayerGauge value={judge.player} />
                </div>
              )}
              <div class="judge-chips">
                {judge.stage && <span><i>{t.chips.stage}</i>{judge.stage}</span>}
                {judge.pursuit && <span><i>{t.chips.pursuit}</i>{judge.pursuit}</span>}
                {judge.vibe && <span><i>{t.chips.vibe}</i>{judge.vibe}</span>}
                {judge.extra.map(([k, v]) => <span key={k}><i>{k}</i>{v}</span>)}
              </div>
              {mode === "reply" && <button class="judge-more" onClick={() => setOpen(false)}>{t.collapse}</button>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const KV_META: Record<string, { seal: string; title: () => string; tone: "zhu" | "ink" | "dai" | "jade" | "ochre" }> = {
  strategy: { seal: "令", title: () => T().orders, tone: "ink" },
  aside: { seal: "注", title: () => T().aside, tone: "dai" },
  sticker: { seal: "图", title: () => T().gifIdea, tone: "dai" },
  stop: { seal: "醒", title: () => T().realityCheck, tone: "zhu" },
};

function KVCard({ kind, rows }: { kind: string; rows: Array<[string, string]> }) {
  const meta = KV_META[kind];
  if (!meta || !rows.length) return null;
  if (kind === "strategy") {
    return (
      <section class="order">
        <header><Seal char="令" size={26} tone="ink" tilt={-4} /><b>{meta.title()}</b></header>
        <div class="order-grid">
          {rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
      </section>
    );
  }
  return (
    <section class={`kv kv-${kind}`}>
      <header><Seal char={meta.seal} size={24} tone={meta.tone} tilt={-3} /><b>{meta.title()}</b></header>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

/** 结论 → 印。中英两种契约的说法都认。 */
function verdictSeal(conclusion: string): [string, "jade" | "ochre" | "zhu" | "ink"] {
  const c = conclusion.trim().toLowerCase();
  if (/^(可以说|send it|good to go|send)/.test(c)) return ["可", "jade"];
  if (/^(需要调整|tweak|adjust|fix)/.test(c)) return ["改", "ochre"];
  if (/^(不建议|don'?t send|do not send|skip)/.test(c)) return ["否", "zhu"];
  return ["评", "ink"];
}

const VERDICT_KEYS = ["结论", "call", "适配", "fit", "油腻", "thirst"];

function VerdictCard({ rows, cap }: { rows: Array<[string, string]>; cap: number }) {
  const t = T();
  const get = (...keys: string[]) => rows.find(([k]) => keys.includes(k.toLowerCase()))?.[1];
  const conclusion = get("结论", "call") ?? "";
  const [char, tone] = verdictSeal(conclusion);
  const num = (...keys: string[]) => { const v = get(...keys); const m = v?.match(/\d+(\.\d+)?/); return m ? Number(m[0]) : undefined; };
  const oil = num("油腻", "thirst");
  return (
    <section class={`verdict tone-${tone}`}>
      <Seal char={char} size={64} tone={tone === "ink" ? "ink" : tone} tilt={-6} class="verdict-seal" />
      <div class="verdict-body">
        <h3>{conclusion || (uiLang() === "en" ? "Verdict" : "评估")}</h3>
        <div class="verdict-meters">
          <Meter label={t.fitLabel} value={num("适配", "fit")} />
          <Meter label={t.oilLabel} value={oil} max={5} tone={(oil ?? 0) > cap ? "zhu" : "ink"} />
        </div>
        <dl>
          {rows.filter(([k]) => !VERDICT_KEYS.includes(k.toLowerCase())).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
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
  const t = T();
  const phase = live.status ?? (!live.context ? t.thinkingPhase.dossier : live.firstTokenAt ? t.thinkingPhase.writing : live.context.modules.includes("profile") ? t.thinkingPhase.shots : t.thinkingPhase.plan);
  return (
    <div class="thinking" aria-live="polite">
      <span class="ink-drop" />
      <span>{live.status ? `${live.status.replace(/…+$/, "")}…` : t.thinkingLine(phase)}</span>
      <em>{sec}s</em>
      {live.context && !live.firstTokenAt && (
        <small>
          {t.ctxFacts(live.context.facts)}
          {live.context.recalled.length ? t.ctxRecalled(live.context.recalled.length) : ""}
          {live.context.festivals.length ? t.ctxNear(live.context.festivals[0]) : ""}
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
      nodes.push(<p key={i} class="pick"><Seal char="荐" size={22} variant="line" tilt={-6} title={T().recStamp} /><b>{uiLang() === "en" ? SEAL_EN[g.seal] ?? g.seal : g.seal}</b><span>{g.why}</span></p>);
    } else if (g.type === "avoid") {
      nodes.push(<p key={i} class="avoid"><span class="avoid-mark">{T().avoidMark}</span><s>{g.text}</s>{g.why && <span class="avoid-why">{g.why}</span>}</p>);
    } else if (g.type === "hold") {
      nodes.push(<p key={i} class="avoid hold"><span class="avoid-mark">{T().holdMark}</span><span>{g.text}</span>{g.why && <span class="avoid-why">{g.why}</span>}</p>);
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
          <span>{turn.error ?? T().failedTurn}</span>
        </div>
      )}
      {!streaming && parsed.segments.length > 0 && <Brush width={56} class="answer-end" />}
    </div>
  );
}
