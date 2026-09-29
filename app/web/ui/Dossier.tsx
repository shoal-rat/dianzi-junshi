import { useState } from "preact/hooks";
import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { refreshDossier, reportError, setState, useApp, watchJob } from "../lib/store";
import { ago } from "../lib/format";
import { FACT_SLOTS, OUTCOMES, type DossierDTO, type FactDTO, type FactSlot, type PersonDTO, type ReadingPoint } from "../../src/shared/domain";

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
    <svg class="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`兴趣走势：${pts.map((p) => p.overall).join("、")}`}>
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
  if (!withData.length) return <p class="dz-empty">聊上几轮，这里会画出 ta 的热度走势：甜度、主动、承诺、行动分开看。</p>;
  const first = withData.find((r) => r.overall !== undefined)?.overall;
  const delta = last?.overall !== undefined && first !== undefined ? last.overall - first : 0;
  return (
    <div class="trend">
      <div class="trend-head">
        <b class="trend-num">{last?.overall ?? "–"}</b>
        <span>/10 兴趣<br /><em class={delta > 0 ? "up" : delta < 0 ? "down" : ""}>{withData.length} 次读数{delta ? `，比最早 ${delta > 0 ? "高" : "低"} ${Math.abs(delta)}` : ""}</em></span>
        {player !== undefined && <span class="trend-player" style={`--v:${player}`}>海王 <b>{player}</b></span>}
      </div>
      <Spark points={d.readings} />
      {last && (
        <div class="trend-bars">
          {([["甜度", last.sweet], ["主动", last.initiative], ["承诺", last.commitment], ["行动", last.action]] as const).map(([k, v]) => (
            <div key={k} class={k === "行动" ? "act" : ""}><span>{k}</span><i><b style={`height:${((v ?? 0) / 10) * 100}%`} /></i><em>{v ?? "–"}</em></div>
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
  if (edit) {
    return (
      <form class="fact editing" onSubmit={(e) => { e.preventDefault(); setEdit(false); if (text.trim() && text !== fact.text) void save({ text }); }}>
        <input value={text} autoFocus onInput={(e) => setText((e.target as HTMLInputElement).value)} onBlur={() => setEdit(false)} />
      </form>
    );
  }
  return (
    <span class={`fact ${fact.pinned ? "pinned" : ""} ${fact.status !== "active" ? "stale" : ""}`} title={`${fact.sourceLabel} · 置信 ${Math.round(fact.confidence * 100)}%${fact.seen > 1 ? ` · 见过 ${fact.seen} 次` : ""}`}>
      <span class="fact-text" onClick={() => setEdit(true)}>{fact.text}{fact.date ? <em>{fact.date.slice(5)}</em> : null}</span>
      <button class="fact-act" title={fact.pinned ? "取消确认" : "确认没错（不会被覆盖、不会过期）"} onClick={() => save({ pinned: !fact.pinned })}><Icon name="pin" size={12} /></button>
      <button class="fact-act" title="删掉" onClick={() => save({ status: "removed" })}><Icon name="x" size={12} /></button>
    </span>
  );
}

function Facts({ d, person }: { d: DossierDTO; person: PersonDTO }) {
  const [slot, setSlot] = useState<FactSlot>("like");
  const [text, setText] = useState("");
  const [showStale, setShowStale] = useState(false);
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
      {!active.length && <p class="dz-empty">还没记下什么。导入以前的截图，或者直接在下面写一条——军师每次都会带上它。</p>}
      {slots.map((s) => (
        <div key={s} class="fact-group">
          <span class="fact-slot">{FACT_SLOTS[s]}</span>
          <div class="fact-list">{active.filter((f) => f.slot === s).map((f) => <FactChip key={f.id} fact={f} person={person} />)}</div>
        </div>
      ))}
      <form class="fact-add" onSubmit={add}>
        <select value={slot} onChange={(e) => setSlot((e.target as HTMLSelectElement).value as FactSlot)} aria-label="栏目">
          {(Object.keys(FACT_SLOTS) as FactSlot[]).map((s) => <option key={s} value={s}>{FACT_SLOTS[s]}</option>)}
        </select>
        <input value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} placeholder="记一条，比如：不吃香菜" />
        <button class="icon-btn" aria-label="添加"><Icon name="plus" size={16} /></button>
      </form>
      {stale.length > 0 && (
        <button class="link dz-stale" onClick={() => setShowStale(!showStale)}>{showStale ? "收起" : `过期或被覆盖的 ${stale.length} 条`}</button>
      )}
      {showStale && <div class="fact-list stale-list">{stale.map((f) => <FactChip key={f.id} fact={f} person={person} />)}</div>}
    </>
  );
}

function Tactics({ d }: { d: DossierDTO }) {
  if (!d.tactics.length) return <p class="dz-empty">复制锦囊、发出去，回来点一下「后来怎样」。几次之后，这里会告诉你哪种打法对 ta 最管用。</p>;
  return (
    <>
      <div class="tactics">
        {d.tactics.map((t) => (
          <div key={t.seal} class="tactic">
            {t.seal.length === 1 ? <Seal char={t.seal} size={22} tone={t.seal === "撩" ? "zhu" : t.seal === "奇" ? "dai" : "ink"} /> : <span class="tactic-self">{t.seal}</span>}
            <div class="tactic-bar" title={`接住 ${t.good} · 一般 ${t.meh} · 冷 ${t.cold} · 没回 ${t.ghosted}`}>
              {t.good > 0 && <i class="good" style={`flex:${t.good}`} />}
              {t.meh > 0 && <i class="meh" style={`flex:${t.meh}`} />}
              {t.cold > 0 && <i class="cold" style={`flex:${t.cold}`} />}
              {t.ghosted > 0 && <i class="ghosted" style={`flex:${t.ghosted}`} />}
            </div>
            <em>{t.good}/{t.tries}</em>
          </div>
        ))}
      </div>
      {d.worked.length > 0 && (
        <ul class="lines worked">{d.worked.slice(0, 4).map((w, i) => <li key={i}><span>{w.text.replace(/\n/g, " / ")}</span>{w.count > 1 && <em>×{w.count}</em>}</li>)}</ul>
      )}
      {d.flopped.length > 0 && (
        <ul class="lines flopped">{d.flopped.slice(0, 4).map((f, i) => <li key={i}><s>{f.text.replace(/\n/g, " / ")}</s><em>{OUTCOMES[f.result].label}</em></li>)}</ul>
      )}
    </>
  );
}

function Archive({ d, person }: { d: DossierDTO; person: PersonDTO }) {
  const job = d.job;
  const active = job && (job.status === "running" || job.status === "queued");
  return (
    <div class="archive">
      <p><b>{d.archive.total}</b> 段原文在本机可以被找回<span>（截图 {d.archive.screenshots} · 旧聊天 {d.archive.pastes}）</span></p>
      {job && job.status !== "done" && (
        <div class={`job job-${job.status}`}>
          <div class="job-head"><span>{job.message}</span><em>{job.done}/{job.total}</em></div>
          <div class="job-bar"><i style={`width:${(job.done / Math.max(1, job.total)) * 100}%`} /></div>
          {active && job.current && <small>正在整理：{job.current}</small>}
          {job.failed > 0 && !active && <button class="link" onClick={async () => { try { await api.retryJob(job.id); watchJob(person.id, job.id); } catch (e) { reportError(e); } }}>重试失败的 {job.failed} 条</button>}
        </div>
      )}
      <button class="btn btn-line wide" onClick={() => setState({ dialog: { type: "import" } })}><Icon name="upload" size={15} />导入截图或旧聊天</button>
    </div>
  );
}

export function Dossier({ person }: { person: PersonDTO }) {
  const s = useApp();
  const d = s.dossiers[person.id];
  return (
    <aside class="dossier" aria-label="档案卡">
      <header class="dz-head">
        <div>
          <span class="dz-kicker">档案</span>
          <h2>{person.name}</h2>
        </div>
        <button class="icon-btn" aria-label="收起档案" onClick={() => setState(window.innerWidth < 1180 ? { drawer: null } : { dossierOpen: false })}><Icon name="x" /></button>
      </header>
      {!d ? <p class="dz-empty">正在翻档案…</p> : (
        <div class="dz-scroll">
          <section><h3>热度</h3><Trend d={d} /></section>
          <section><h3>关于 ta<small>每次都会带给军师</small></h3><Facts d={d} person={person} /></section>
          {d.memes.length > 0 && (
            <section>
              <h3>ta 的梗<small>镜像回去最安全</small></h3>
              <div class="memes">
                {d.memes.map((m) => (
                  <button key={m.term} class={`meme ${m.avoid ? "avoid" : ""}`} title={m.avoid ? "标成了 ta 反感，点一下取消" : "点一下标成 ta 反感、别用"}
                    onClick={async () => { try { await api.meme(person.id, m.term, { avoid: !m.avoid }); await refreshDossier(person.id); } catch (e) { reportError(e); } }}>
                    {m.term}{m.count > 1 && <em>×{m.count}</em>}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section><h3>打法战绩<small>真实结果，不是猜的</small></h3><Tactics d={d} /></section>
          <section>
            <h3>你的风格</h3>
            {d.style.samples >= 2
              ? <p class="style">你实际发出去的话：每条气泡平均 <b>{d.style.avgLen}</b> 字，一次 <b>{d.style.bubbles}</b> 条{d.style.habits.length ? `；${d.style.habits.join("，")}` : ""}。锦囊会照着这个写。</p>
              : <p class="dz-empty">记几次「你实际发了什么」，军师就会照着你的说话习惯写。</p>}
          </section>
          <section><h3>素材库</h3><Archive d={d} person={person} /></section>
        </div>
      )}
    </aside>
  );
}
