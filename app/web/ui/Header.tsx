import { useState } from "preact/hooks";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { refreshPeople, reportError, setState, useApp } from "../lib/store";
import { NERVES, STAGES, oilCap, stageOf, type PersonDTO } from "../../src/shared/domain";

async function patch(person: PersonDTO, p: Partial<{ stage: number; nerve: number; clearEyed: boolean }>) {
  try {
    const next = await api.updatePerson(person.id, p);
    setState((s) => ({ people: s.people.map((x) => (x.id === next.id ? { ...x, ...next } : x)) }));
    void refreshPeople();
  } catch (e) { reportError(e); }
}

export function Nerve({ value, onChange, compact }: { value: number; onChange: (n: number) => void; compact?: boolean }) {
  return (
    <div class={`nerve ${compact ? "compact" : ""}`} role="radiogroup" aria-label="胆量">
      {!compact && <span class="nerve-label">胆量</span>}
      <div class="nerve-track" data-lvl={value}>
        {NERVES.map((g) => (
          <button key={g.n} role="radio" aria-checked={g.n === value} class={`nerve-step ${g.n <= value ? "on" : ""} ${g.n === value ? "cur" : ""}`}
            data-n={g.n} title={`${g.name}：${g.brief}`} onClick={() => onChange(g.n)}>
            <i />
          </button>
        ))}
      </div>
      <b class="nerve-name" data-n={value}>{NERVES[value]?.name}</b>
    </div>
  );
}

export function Header({ person }: { person: PersonDTO }) {
  const s = useApp();
  const [stageOpen, setStageOpen] = useState(false);
  const stage = stageOf(person.stage);
  return (
    <header class="desk-head">
      <button class="icon-btn only-narrow" aria-label="打开名册" onClick={() => setState({ drawer: "left" })}><Icon name="menu" /></button>
      <div class="desk-title">
        <button class="desk-name" onClick={() => setState({ dialog: { type: "person" } })} title="改名字、备注">{person.name}</button>
        <div class="stage-pick">
          <button class="stage-btn" onClick={() => setStageOpen(!stageOpen)} aria-expanded={stageOpen}>
            {stage.name}<small>油腻上限 {oilCap(person.stage, person.nerve)}</small><Icon name="chevron" size={14} />
          </button>
          {stageOpen && (
            <div class="stage-menu" role="listbox" onMouseLeave={() => setStageOpen(false)}>
              {STAGES.map((st) => (
                <button key={st.n} role="option" aria-selected={st.n === person.stage} class={st.n === person.stage ? "cur" : ""}
                  onClick={() => { setStageOpen(false); void patch(person, { stage: st.n }); }}>
                  <b>{st.name}</b><span>{st.short}</span><i>上限 {st.cap}</i>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div class="desk-tools">
        <Nerve value={person.nerve} onChange={(n) => patch(person, { nerve: n })} />
        <label class={`clear-eyed ${person.clearEyed ? "on" : ""}`} title="对方明显只是吊着你时，军师会像朋友一样直接拦住你">
          <input type="checkbox" checked={person.clearEyed} onChange={(e) => patch(person, { clearEyed: (e.target as HTMLInputElement).checked })} />
          <span class="switch" /><span>清醒提醒</span>
        </label>
        <button class={`icon-btn dossier-toggle ${s.dossierOpen ? "on" : ""}`} aria-label="档案卡" title="档案卡"
          onClick={() => (window.innerWidth < 1180 ? setState({ drawer: s.drawer === "right" ? null : "right" }) : setState({ dossierOpen: !s.dossierOpen }))}>
          <Icon name="book" /><span class="only-wide">档案</span>
        </button>
      </div>
    </header>
  );
}
