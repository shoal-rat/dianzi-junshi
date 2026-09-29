import { useState } from "preact/hooks";
import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { copyText } from "../lib/format";
import { patchTurn, reportError, toast } from "../lib/store";
import type { Plan } from "../../src/shared/contract";
import type { PlanCheck, TurnDTO } from "../../src/shared/domain";

const SEAL_TONE: Record<string, "zhu" | "ink" | "dai"> = { 稳: "ink", 撩: "zhu", 奇: "dai" };
const SEAL_WORD: Record<string, string> = { 稳: "稳妥", 撩: "会撩", 奇: "出奇" };

export function Oil({ value, cap }: { value?: number; cap?: number }) {
  if (value === undefined) return null;
  const over = cap !== undefined && value > cap + 0.01;
  return (
    <span class={`oil ${over ? "over" : ""}`} title={`油腻度 ${value}/5${cap !== undefined ? `，这段关系现在的上限是 ${cap}` : ""}`}>
      <span class="oil-drops">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} class={value >= i ? "full" : value >= i - 0.5 ? "half" : ""} data-cap={cap !== undefined && Math.ceil(cap) === i ? "1" : undefined} />
        ))}
      </span>
      <b>油 {value}</b>
    </span>
  );
}

function Checked({ check }: { check?: PlanCheck }) {
  if (!check) return null;
  const warns = check.lint.findings.filter((f) => f.level === "WARN");
  if (check.stuck) return <span class="lint-tag stuck" title={check.stuck}>卡：{check.stuck}</span>;
  if (check.lint.result === "FAIL") return <span class="lint-tag stuck">{check.lint.findings[0]?.hint}</span>;
  return (
    <span class="lint-tag pass" title={warns.length ? warns.map((w) => `${w.text}：${w.hint}`).join("\n") : "过了人话检查"}>
      <Seal char="过" size={16} tone="jade" />{check.revised ? "改过一稿" : warns.length ? `过关 · ${warns.length} 处可再顺` : "人话过关"}
    </span>
  );
}

const ASKS = ["更短", "更撩一点", "更稳一点", "换个说法", "更像我平时说话"];

export function PlanCard({ plan, turn, check, recommended, cap, streaming }: {
  plan: Plan; turn: TurnDTO; check?: PlanCheck; recommended: boolean; cap?: number; streaming: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const copied = (turn.copied ?? []).includes(plan.index);
  const text = plan.lines.join("\n");

  async function doCopy() {
    const ok = await copyText(text);
    if (!ok) { toast("复制没成功，手动选一下文字", "zhu"); return; }
    toast("复制好了。发完回来点「后来怎样」，军师会越来越懂 ta", "jade");
    patchTurn(turn.personId, turn.id, { copied: [...new Set([...(turn.copied ?? []), plan.index])] });
    api.copied(turn.id, plan.index).catch(() => {});
  }

  async function revise(ask: string) {
    setMenu(false);
    setBusy(true);
    try {
      const next = await api.revise(turn.id, plan.index, ask);
      patchTurn(turn.personId, turn.id, { output: next.output, checks: next.checks });
      toast("改好了", "jade");
    } catch (e) { reportError(e); } finally { setBusy(false); setCustom(""); }
  }

  return (
    <div class={`plan seal-${plan.seal} ${recommended ? "is-rec" : ""} ${copied ? "is-copied" : ""} ${plan.open && streaming ? "is-writing" : ""}`}>
      {recommended && <Seal char="荐" size={42} variant="line" tilt={12} class="rec-stamp" title="军师推荐" />}
      <header class="plan-head">
        <Seal char={plan.seal} size={30} tone={SEAL_TONE[plan.seal] ?? "zhu"} tilt={-3} title={SEAL_WORD[plan.seal] ?? plan.seal} />
        <div class="plan-title">
          <b>{plan.title || SEAL_WORD[plan.seal] || "锦囊"}</b>
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
                <Icon name="pen" size={15} />{busy ? "在改…" : "改改"}
              </button>
              {menu && (
                <div class="revise-menu" onMouseLeave={() => setMenu(false)}>
                  {ASKS.map((a) => <button key={a} onClick={() => revise(a)}>{a}</button>)}
                  <form onSubmit={(e) => { e.preventDefault(); if (custom.trim()) void revise(custom); }}>
                    <input value={custom} onInput={(e) => setCustom((e.target as HTMLInputElement).value)} placeholder="自己说：比如别提吃饭" />
                  </form>
                </div>
              )}
            </div>
            <button class={`btn ${copied ? "btn-line" : "btn-ink"}`} onClick={doCopy}>
              <Icon name={copied ? "check" : "copy"} size={15} />{copied ? "已复制" : "复制"}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
