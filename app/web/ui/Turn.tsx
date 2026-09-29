import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Answer } from "./Answer";
import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { circled, when } from "../lib/format";
import { draftOf, reloadTurns, refreshDossier, reportError, setDraft, setState, toast } from "../lib/store";
import { parseAnswer, type Annotation } from "../../src/shared/contract";
import { T, uiLang } from "../lib/i18n";
import { labels, laneLabel, SEAL_EN, type Outcome, type PersonDTO, type TurnDTO } from "../../src/shared/domain";
import type { Live } from "../lib/store";

/** 把批注画到原话上：每个片段第一次出现的位置画朱线、标序号。 */
function annotate(text: string, notes: Annotation[]): { nodes: ComponentChildren[]; used: Annotation[] } {
  const spans: Array<{ start: number; end: number; n: number }> = [];
  const used: Annotation[] = [];
  for (const note of notes) {
    const q = note.quote.trim();
    if (!q) continue;
    let idx = text.indexOf(q);
    while (idx >= 0 && spans.some((s) => idx < s.end && idx + q.length > s.start)) idx = text.indexOf(q, idx + 1);
    if (idx < 0) continue;
    used.push(note);
    spans.push({ start: idx, end: idx + q.length, n: used.length });
  }
  spans.sort((a, b) => a.start - b.start);
  const nodes: ComponentChildren[] = [];
  let last = 0;
  for (const s of spans) {
    if (s.start > last) nodes.push(text.slice(last, s.start));
    nodes.push(<mark class="pi" key={s.n}>{text.slice(s.start, s.end)}<sup>{circled(s.n)}</sup></mark>);
    last = s.end;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return { nodes, used };
}


const DEAD = new Set(["过气（别用）", "dead", "never"]);

function Slip({ turn, person }: { turn: TurnDTO; person: PersonDTO }) {
  const t = T();
  const L = labels(uiLang());
  const parsed = parseAnswer(turn.output);
  const judgeNotes = parsed.judge?.notes ?? [];
  const memeNotes: Annotation[] = turn.memes
    .filter((m) => !judgeNotes.some((n) => n.quote.includes(m.matched)))
    .map((m) => ({ quote: m.matched, note: t.memeNote(DEAD.has(m.status), m.meaning, m.tone) }));
  const notes = [...judgeNotes, ...memeNotes];
  const body = turn.input.trim();
  const original = parsed.judge?.original;
  const main = annotate(body, notes);
  const fromShot = !body && original ? annotate(original, notes) : null;
  const shown = [...main.used, ...(fromShot?.used ?? [])];
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div class="slip">
      <div class="slip-meta">
        <span class="slip-who">{turn.mode === "polish" ? t.slipDraft : turn.mode === "odds" ? t.slipSituation : t.slipSays(L.pronoun(person.gender))}</span>
        <span class="slip-mode">{L.modes[turn.mode].label}</span>
        <time>{when(turn.createdAt)}</time>
      </div>
      {body && <p class="slip-text">{main.nodes}</p>}
      {turn.images.length > 0 && (
        <div class="slip-shots">
          {turn.images.map((img) => (
            <button key={img.id} class="shot" onClick={() => setZoom(img.url)} aria-label={t.zoomShot(img.name)}>
              <img src={img.url} alt={img.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {fromShot && <p class="slip-text from-shot"><span class="slip-from">{t.slipFromShot(person.name)}</span>{fromShot.nodes}</p>}
      {shown.length > 0 && (
        <ol class="pi-notes">
          {shown.map((n, i) => <li key={i}><b>{circled(i + 1)}</b><span class="pi-q">{n.quote}</span><span class="pi-n">{n.note}</span></li>)}
        </ol>
      )}
      {zoom && (
        <div class="lightbox" onClick={() => setZoom(null)} role="dialog" aria-label={t.shotDialog}>
          <img src={zoom} alt="" />
        </div>
      )}
    </div>
  );
}

function AfterBar({ turn, person }: { turn: TurnDTO; person: PersonDTO }) {
  const t = T();
  const L = labels(uiLang());
  const parsed = parseAnswer(turn.output);
  const [busy, setBusy] = useState(false);
  if (turn.status !== "done" || !parsed.plans.length || turn.mode === "read") return null;
  const copied = turn.copied ?? [];
  const chosen = parsed.plans.find((p) => copied.includes(p.index)) ?? parsed.plans.find((p) => p.seal === parsed.pick?.seal) ?? parsed.plans[0];
  if (turn.outcome) {
    const o = turn.outcome;
    return (
      <div class={`after done r-${o.result}`}>
        <span class="after-label">{t.after}</span>
        <b>{L.outcomes[o.result].label}</b>
        <span class="after-sent">{t.afterSent(o.sent.replace(/\n/g, " / "))}</span>
        {o.reply && <span class="after-reply">{t.afterReply(o.reply.slice(0, 60))}</span>}
        <button class="link" onClick={() => setState({ dialog: { type: "feedback", turnId: turn.id, planIndex: o.planIndex } })}>{t.afterEdit}</button>
      </div>
    );
  }
  async function quick(result: Outcome) {
    if (!chosen) return;
    setBusy(true);
    try {
      await api.recordOutcome(person.id, { turnId: turn.id, planIndex: chosen.index, seal: chosen.seal, suggested: chosen.lines.join("\n"), sent: chosen.lines.join("\n"), result });
      await Promise.all([reloadTurns(person.id), refreshDossier(person.id)]);
      toast(result === "good" ? t.toastGood : result === "meh" ? t.toastMeh : t.toastCold, "jade");
    } catch (e) { reportError(e); } finally { setBusy(false); }
  }
  return (
    <div class={`after ${copied.length ? "asking" : ""}`}>
      <span class="after-label">{copied.length ? t.afterAsk(uiLang() === "en" ? SEAL_EN[chosen?.seal ?? ""] ?? chosen?.seal ?? "" : `「${chosen?.seal}」`) : t.afterHow}</span>
      {(Object.keys(L.outcomes) as Outcome[]).map((r) => (
        <button key={r} class={`chip r-${r}`} disabled={busy} onClick={() => quick(r)}>{L.outcomes[r].label}</button>
      ))}
      <button class="link" onClick={() => setState({ dialog: { type: "feedback", turnId: turn.id, planIndex: chosen?.index } })}>{t.afterMore}</button>
    </div>
  );
}

function Meta({ turn }: { turn: TurnDTO }) {
  const [open, setOpen] = useState(false);
  const t = T();
  const ui = uiLang();
  const c = turn.context;
  const bits = [
    turn.provider === "demo" ? t.metaDemo : turn.model || turn.provider,
    c?.lang && c.lang !== ui ? (c.lang === "en" ? t.metaEnglish : t.metaChinese) : "",
    c ? t.metaLane(laneLabel(c.lane, ui)) : "",
    c?.facts ? t.metaFacts(c.facts) : "",
    c?.recalled.length ? t.metaRecalled(c.recalled.length) : "",
    c?.tactics ? t.metaTactics(c.tactics) : "",
  ].filter(Boolean);
  async function remove() {
    if (!confirm(t.confirmDeleteTurn)) return;
    try { await api.deleteTurn(turn.id); await reloadTurns(turn.personId); } catch (e) { reportError(e); }
  }
  function again() {
    const d = draftOf(turn.personId);
    setDraft(turn.personId, { mode: turn.mode, text: turn.input, images: turn.images.length ? turn.images : d.images });
    setTimeout(() => (document.querySelector(".composer textarea") as HTMLTextAreaElement | null)?.focus(), 30);
  }
  return (
    <div class="turn-meta">
      <button class="link" onClick={() => setOpen(!open)} disabled={!c}>{bits.join(" · ")}</button>
      <span class="turn-meta-actions">
        <button class="icon-btn tiny" title={t.askAgain} onClick={again}><Icon name="refresh" size={14} /></button>
        <button class="icon-btn tiny" title={t.deleteTurn} onClick={remove}><Icon name="trash" size={14} /></button>
      </span>
      {open && c && (
        <div class="turn-context">
          <p>{t.loadedModules}{c.modules.join(" · ")}{c.festivals.length ? ` ｜ ${t.upcoming}${c.festivals.join(ui === "en" ? ", " : "、")}` : ""}</p>
          {c.recalled.map((r) => (
            <p key={r.id} class="recall"><i>{t.kind[r.kind] ?? t.kind.turn}</i>{r.text}<em>{r.why}</em></p>
          ))}
        </div>
      )}
    </div>
  );
}

export function Turn({ turn, person, live }: { turn: TurnDTO; person: PersonDTO; live?: Live | null }) {
  return (
    <article class={`turn mode-${turn.mode}`} id={`turn-${turn.id}`}>
      <Slip turn={turn} person={person} />
      <div class="counsel">
        <div class="counsel-mark"><Seal char="军" size={30} tilt={-6} /></div>
        <div class="counsel-body">
          <Answer turn={turn} person={person} live={live} />
          {!live && <AfterBar turn={turn} person={person} />}
          {!live && <Meta turn={turn} />}
        </div>
      </div>
    </article>
  );
}
