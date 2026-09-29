import { useState } from "preact/hooks";
import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { copyText } from "../lib/format";
import { patchTurn, reportError, toast } from "../lib/store";
import type { Plan } from "../../src/shared/contract";
import type { PlanCheck, TurnDTO } from "../../src/shared/domain";
import { T, uiLang } from "../lib/i18n";

const SEAL_TONE: Record<string, "zhu" | "ink" | "dai"> = { 稳: "ink", 撩: "zhu", 奇: "dai" };

export function Oil({ value, cap }: { value?: number; cap?: number }) {
  if (value === undefined) return null;
  const over = cap !== undefined && value > cap + 0.01;
  const t = T();
  return (
    <span class={`oil ${over ? "over" : ""}`} title={t.oilTip(value, cap)}>
      <span class="oil-drops">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} class={value >= i ? "full" : value >= i - 0.5 ? "half" : ""} data-cap={cap !== undefined && Math.ceil(cap) === i ? "1" : undefined} />
        ))}
      </span>
      <b>{t.oilWord(value)}</b>
    </span>
  );
}

function Checked({ check }: { check?: PlanCheck }) {
  if (!check) return null;
  const t = T();
  const warns = check.lint.findings.filter((f) => f.level === "WARN");
  if (check.stuck) return <span class="lint-tag stuck" title={check.stuck}>{t.stuck(check.stuck)}</span>;
  if (check.lint.result === "FAIL") return <span class="lint-tag stuck">{check.lint.findings[0]?.hint}</span>;
  return (
    <span class="lint-tag pass" title={warns.length ? warns.map((w) => `${w.text}${uiLang() === "en" ? ": " : "："}${w.hint}`).join("\n") : t.passTip}>
      <Seal char="过" size={16} tone="jade" />{check.revised ? t.passRevised : warns.length ? t.passWarn(warns.length) : t.pass}
    </span>
  );
}

export function PlanCard({ plan, turn, check, recommended, cap, streaming }: {
  plan: Plan; turn: TurnDTO; check?: PlanCheck; recommended: boolean; cap?: number; streaming: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const t = T();
  const en = uiLang() === "en";
  const copied = (turn.copied ?? []).includes(plan.index);
  const text = plan.lines.join("\n");

  async function doCopy() {
    const ok = await copyText(text);
    if (!ok) { toast(t.copyFail, "zhu"); return; }
    toast(t.copyOk, "jade");
    patchTurn(turn.personId, turn.id, { copied: [...new Set([...(turn.copied ?? []), plan.index])] });
    api.copied(turn.id, plan.index).catch(() => {});
  }

  async function revise(ask: string) {
    setMenu(false);
    setBusy(true);
    try {
      const next = await api.revise(turn.id, plan.index, ask);
      patchTurn(turn.personId, turn.id, { output: next.output, checks: next.checks });
      toast(t.revised, "jade");
    } catch (e) { reportError(e); } finally { setBusy(false); setCustom(""); }
  }

  return (
    <div class={`plan seal-${plan.seal} ${recommended ? "is-rec" : ""} ${copied ? "is-copied" : ""} ${plan.open && streaming ? "is-writing" : ""}`}>
      {recommended && <Seal char="荐" size={42} variant="line" tilt={12} class="rec-stamp" title={t.recStamp} />}
      {recommended && en && <span class="rec-caption">{t.recStamp}</span>}
      <header class="plan-head">
        <Seal char={plan.seal} size={30} tone={SEAL_TONE[plan.seal] ?? "zhu"} tilt={-3} title={t.sealWord[plan.seal] ?? plan.seal} />
        <div class="plan-title">
          {en && plan.title && t.sealCaption[plan.seal] && <span class="seal-caption">{t.sealCaption[plan.seal]}</span>}
          <b>{plan.title || t.sealWord[plan.seal] || t.plan}</b>
          <Oil value={plan.oil} cap={cap} />
        </div>
      </header>
      <div class={`bubbles ${busy ? "busy" : ""}`}>
        {plan.lines.length ? plan.lines.map((l, i) => <p key={i} class="bubble">{l}</p>) : <p class="bubble ghost">…</p>}
      </div>
      {plan.why && <p class="plan-why">{plan.why}</p>}
      {!streaming && plan.lines.length > 0 && (
        <footer class="plan-foot">
          <Checked check={check} />
          <div class="plan-actions">
            <div class="revise">
              <button class="btn btn-quiet" disabled={busy} onClick={() => setMenu(!menu)}>
                <Icon name="pen" size={15} />{busy ? t.revising : t.revise}
              </button>
              {menu && (
                <div class="revise-menu" onMouseLeave={() => setMenu(false)}>
                  {t.asks.map((a) => <button key={a} onClick={() => revise(a)}>{a}</button>)}
                  <form onSubmit={(e) => { e.preventDefault(); if (custom.trim()) void revise(custom); }}>
                    <input value={custom} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} placeholder={t.askCustom} />
                  </form>
                </div>
              )}
            </div>
            <button class={`btn ${copied ? "btn-line" : "btn-ink"}`} onClick={doCopy}>
              <Icon name={copied ? "check" : "copy"} size={15} />{copied ? t.copied : t.copy}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
