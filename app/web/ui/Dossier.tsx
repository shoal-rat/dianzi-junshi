import { useState } from "preact/hooks";
import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { refreshDossier, reportError, setState, useApp, watchJob } from "../lib/store";
import { ago } from "../lib/format";
import { T, uiLang } from "../lib/i18n";
import { labels, type DossierDTO, type FactDTO, type FactSlot, type PersonDTO, type ReadingPoint } from "../../src/shared/domain";

function Spark({ points }: { points: ReadingPoint[] }) {
  const pts = points.filter((p) => p.overall !== undefined);
  if (pts.length < 2) return null;
  const w = 260;
  const h = 64;
  const x = (i: number) => 6 + (i * (w - 12)) / (pts.length - 1);
  const y = (v: number) => h - 6 - (v / 10) * (h - 12);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.overall!).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg class="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${T().heat}: ${pts.map((p) => p.overall).join(", ")}`}>
      {[2.5, 5, 7.5].map((v) => <line key={v} x1="0" x2={w} y1={y(v)} y2={y(v)} class="spark-grid" />)}
      <path d={d} class="spark-line" />
      {pts.map((p, i) => <circle key={p.turnId} cx={x(i)} cy={y(p.overall!)} r={i === pts.length - 1 ? 4 : 2.2} class={i === pts.length - 1 ? "spark-last" : "spark-dot"}><title>{`${p.overall}/10 · ${ago(p.at)}`}</title></circle>)}
      <text x={x(pts.length - 1) - 8} y={y(last.overall!) - 8} class="spark-label" text-anchor="end">{last.overall}</text>
    </svg>
  );
}

function Trend({ d }: { d: DossierDTO }) {
  const withData = d.readings.filter((r) => r.overall !== undefined || r.player !== undefined);
  const last = [...withData].reverse().find((r) => r.overall !== undefined);
  const player = [...d.readings].reverse().find((r) => r.player !== undefined)?.player;
  const t = T();
  if (!withData.length) return <p class="dz-empty">{t.heatEmpty}</p>;
  const first = withData.find((r) => r.overall !== undefined)?.overall;
  const delta = last?.overall !== undefined && first !== undefined ? last.overall - first : 0;
  return (
    <div class="trend">
      <div class="trend-head">
        <b class="trend-num">{last?.overall ?? "–"}</b>
        <span>{t.heatUnit}<br /><em class={delta > 0 ? "up" : delta < 0 ? "down" : ""}>{t.readings(withData.length)}{delta ? t.vsFirst(delta > 0, Math.abs(delta)) : ""}</em></span>
        {player !== undefined && <span class="trend-player" style={`--v:${player}`}>{t.player} <b>{player}</b></span>}
      </div>
      <Spark points={d.readings} />
      {last && (
        <div class="trend-bars">
          {([["sweet", last.sweet], ["initiative", last.initiative], ["commitment", last.commitment], ["action", last.action]] as const).map(([k, v]) => (
            <div key={k} class={k === "action" ? "act" : ""}><span>{t.metersShort[k]}</span><i><b style={`height:${((v ?? 0) / 10) * 100}%`} /></i><em>{v ?? "–"}</em></div>
          ))}
        </div>
      )}
    </div>
  );
}

function FactChip({ fact, person }: { fact: FactDTO; person: PersonDTO }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(fact.text);
  async function save(patch: Parameters<typeof api.updateFact>[2]) {
    try { await api.updateFact(person.id, fact.id, patch); await refreshDossier(person.id); } catch (e) { reportError(e); }
  }
  const t = T();
  if (edit) {
    return (
      <form class="fact editing" onSubmit={(e) => { e.preventDefault(); setEdit(false); if (text.trim() && text !== fact.text) void save({ text }); }}>
        <input value={text} autoFocus onInput={(e) => setText((e.target as HTMLInputElement).value)} onBlur={() => setEdit(false)} />
      </form>
    );
  }
  return (
    <span class={`fact ${fact.pinned ? "pinned" : ""} ${fact.status !== "active" ? "stale" : ""}`} title={t.factTitle(fact.sourceLabel, Math.round(fact.confidence * 100), fact.seen)}>
      <span class="fact-text" onClick={() => setEdit(true)}>{fact.text}{fact.date ? <em>{fact.date.slice(5)}</em> : null}</span>
      <button class="fact-act" title={t.factPin(fact.pinned)} onClick={() => save({ pinned: !fact.pinned })}><Icon name="pin" size={12} /></button>
      <button class="fact-act" title={t.factRemove} onClick={() => save({ status: "removed" })}><Icon name="x" size={12} /></button>
    </span>
  );
}

function Facts({ d, person }: { d: DossierDTO; person: PersonDTO }) {
  const [slot, setSlot] = useState<FactSlot>("like");
  const [text, setText] = useState("");
  const [showStale, setShowStale] = useState(false);
  const t = T();
  const FACT_SLOTS = labels(uiLang()).slots;
  const active = d.facts.filter((f) => f.status === "active");
  const stale = d.facts.filter((f) => f.status !== "active");
  const slots = (Object.keys(FACT_SLOTS) as FactSlot[]).filter((s) => active.some((f) => f.slot === s));
  async function add(e: Event) {
    e.preventDefault();
    if (!text.trim()) return;
    try { await api.addFact(person.id, slot, text); setText(""); await refreshDossier(person.id); } catch (err) { reportError(err); }
  }
  return (
    <>
      {!active.length && <p class="dz-empty">{t.factsEmpty}</p>}
      {slots.map((s) => (
        <div key={s} class="fact-group">
          <span class="fact-slot">{FACT_SLOTS[s]}</span>
          <div class="fact-list">{active.filter((f) => f.slot === s).map((f) => <FactChip key={f.id} fact={f} person={person} />)}</div>
        </div>
      ))}
      <form class="fact-add" onSubmit={add}>
        <select value={slot} onChange={(e) => setSlot((e.target as HTMLSelectElement).value as FactSlot)} aria-label={t.factSlotAria}>
          {(Object.keys(FACT_SLOTS) as FactSlot[]).map((s) => <option key={s} value={s}>{FACT_SLOTS[s]}</option>)}
        </select>
        <input value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} placeholder={t.factPlaceholder} />
        <button class="icon-btn" aria-label={t.add}><Icon name="plus" size={16} /></button>
      </form>
      {stale.length > 0 && (
        <button class="link dz-stale" onClick={() => setShowStale(!showStale)}>{showStale ? t.collapse : t.staleShow(stale.length)}</button>
      )}
      {showStale && <div class="fact-list stale-list">{stale.map((f) => <FactChip key={f.id} fact={f} person={person} />)}</div>}
    </>
  );
}

function Tactics({ d }: { d: DossierDTO }) {
  const t = T();
  const L = labels(uiLang());
  if (!d.tactics.length) return <p class="dz-empty">{t.recordEmpty}</p>;
  return (
    <>
      <div class="tactics">
        {d.tactics.map((x) => (
          <div key={x.seal} class="tactic">
            {x.seal.length === 1 ? <Seal char={x.seal} size={22} tone={x.seal === "撩" ? "zhu" : x.seal === "奇" ? "dai" : "ink"} title={t.sealWord[x.seal]} /> : <span class="tactic-self">{x.seal === "自写" ? t.selfWritten : x.seal}</span>}
            <div class="tactic-bar" title={t.recordTip(x.good, x.meh, x.cold, x.ghosted)}>
              {x.good > 0 && <i class="good" style={`flex:${x.good}`} />}
              {x.meh > 0 && <i class="meh" style={`flex:${x.meh}`} />}
              {x.cold > 0 && <i class="cold" style={`flex:${x.cold}`} />}
              {x.ghosted > 0 && <i class="ghosted" style={`flex:${x.ghosted}`} />}
            </div>
            <em>{x.good}/{x.tries}</em>
          </div>
        ))}
      </div>
      {d.worked.length > 0 && (
        <ul class="lines worked">{d.worked.slice(0, 4).map((w, i) => <li key={i}><span>{w.text.replace(/\n/g, " / ")}</span>{w.count > 1 && <em>×{w.count}</em>}</li>)}</ul>
      )}
      {d.flopped.length > 0 && (
        <ul class="lines flopped">{d.flopped.slice(0, 4).map((f, i) => <li key={i}><s>{f.text.replace(/\n/g, " / ")}</s><em>{L.outcomes[f.result].label}</em></li>)}</ul>
      )}
    </>
  );
}

function Archive({ d, person }: { d: DossierDTO; person: PersonDTO }) {
  const job = d.job;
  const active = job && (job.status === "running" || job.status === "queued");
  const t = T();
  const [n, line, tail] = t.archiveLine(d.archive.total, d.archive.screenshots, d.archive.pastes);
  return (
    <div class="archive">
      <p><b>{n}</b>{line}<span>{tail}</span></p>
      {job && job.status !== "done" && (
        <div class={`job job-${job.status}`}>
          <div class="job-head"><span>{job.message}</span><em>{job.done}/{job.total}</em></div>
          <div class="job-bar"><i style={`width:${(job.done / Math.max(1, job.total)) * 100}%`} /></div>
          {active && job.current && <small>{t.importing(job.current)}</small>}
          {job.failed > 0 && !active && <button class="link" onClick={async () => { try { await api.retryJob(job.id); watchJob(person.id, job.id); } catch (e) { reportError(e); } }}>{t.retryFailed(job.failed)}</button>}
        </div>
      )}
      <button class="btn btn-line wide" onClick={() => setState({ dialog: { type: "import" } })}><Icon name="upload" size={15} />{t.importBtn}</button>
    </div>
  );
}

export function Dossier({ person }: { person: PersonDTO }) {
  const s = useApp();
  const d = s.dossiers[person.id];
  const t = T();
  return (
    <aside class="dossier" aria-label={t.dossierFull}>
      <header class="dz-head">
        <div>
          <span class="dz-kicker">{t.dzKicker}</span>
          <h2>{person.name}</h2>
        </div>
        <button class="icon-btn" aria-label={t.dzClose} onClick={() => setState(window.innerWidth < 1180 ? { drawer: null } : { dossierOpen: false })}><Icon name="x" /></button>
      </header>
      {!d ? <p class="dz-empty">{t.dzLoading}</p> : (
        <div class="dz-scroll">
          <section><h3>{t.heat}</h3><Trend d={d} /></section>
          <section><h3>{t.about}<small>{t.aboutHint}</small></h3><Facts d={d} person={person} /></section>
          {d.memes.length > 0 && (
            <section>
              <h3>{t.theirMemes}<small>{t.theirMemesHint}</small></h3>
              <div class="memes">
                {d.memes.map((m) => (
                  <button key={m.term} class={`meme ${m.avoid ? "avoid" : ""}`} title={t.memeAvoidTip(m.avoid)}
                    onClick={async () => { try { await api.meme(person.id, m.term, { avoid: !m.avoid }); await refreshDossier(person.id); } catch (e) { reportError(e); } }}>
                    {m.term}{m.count > 1 && <em>×{m.count}</em>}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section><h3>{t.record}<small>{t.recordHint}</small></h3><Tactics d={d} /></section>
          <section>
            <h3>{t.yourStyle}</h3>
            {d.style.samples >= 2
              ? <p class="style">{t.styleText(d.style.avgLen ?? 0, d.style.bubbles ?? 1, d.style.habits.join(uiLang() === "en" ? ", " : "，"))}</p>
              : <p class="dz-empty">{t.styleEmpty}</p>}
          </section>
          <section><h3>{t.archive}</h3><Archive d={d} person={person} /></section>
        </div>
      )}
    </aside>
  );
}
