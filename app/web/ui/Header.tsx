import { useState } from "preact/hooks";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { refreshPeople, reportError, setState, useApp } from "../lib/store";
import { T, uiLang } from "../lib/i18n";
import { labels, oilCap, type PersonDTO } from "../../src/shared/domain";

async function patch(person: PersonDTO, p: Partial<{ stage: number; nerve: number; clearEyed: boolean }>) {
  try {
    const next = await api.updatePerson(person.id, p);
    setState((s) => ({ people: s.people.map((x) => (x.id === next.id ? { ...x, ...next } : x)) }));
    void refreshPeople();
  } catch (e) { reportError(e); }
}

export function Nerve({ value, onChange, compact }: { value: number; onChange: (n: number) => void; compact?: boolean }) {
  const t = T();
  const L = labels(uiLang());
  return (
    <div class={`nerve ${compact ? "compact" : ""}`} role="radiogroup" aria-label={t.nerve}>
      {!compact && <span class="nerve-label">{t.nerve}</span>}
      <div class="nerve-track" data-lvl={value}>
        {[0, 1, 2, 3, 4].map((n) => {
          const g = L.nerve(n);
          return (
            <button key={n} role="radio" aria-checked={n === value} class={`nerve-step ${n <= value ? "on" : ""} ${n === value ? "cur" : ""}`}
              data-n={n} title={`${g.name}${uiLang() === "en" ? ": " : "："}${g.brief}`} onClick={() => onChange(n)}>
              <i />
            </button>
          );
        })}
      </div>
      <b class="nerve-name" data-n={value}>{L.nerve(value).name}</b>
    </div>
  );
}

export function Header({ person }: { person: PersonDTO }) {
  const s = useApp();
  const t = T();
  const L = labels(uiLang());
  const [stageOpen, setStageOpen] = useState(false);
  const stage = L.stage(person.stage);
  return (
    <header class="desk-head">
      <button class="icon-btn only-narrow" aria-label={t.openRoster} onClick={() => setState({ drawer: "left" })}><Icon name="menu" /></button>
      <div class="desk-title">
        <button class="desk-name" onClick={() => setState({ dialog: { type: "person" } })} title={t.editPerson}>{person.name}</button>
        <div class="stage-pick">
          <button class="stage-btn" onClick={() => setStageOpen(!stageOpen)} aria-expanded={stageOpen}>
            {stage.name}<small>{t.capLabel(oilCap(person.stage, person.nerve))}</small><Icon name="chevron" size={14} />
          </button>
          {stageOpen && (
            <div class="stage-menu" role="listbox" onMouseLeave={() => setStageOpen(false)}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => {
                const st = L.stage(n);
                return (
                  <button key={n} role="option" aria-selected={n === person.stage} class={n === person.stage ? "cur" : ""}
                    onClick={() => { setStageOpen(false); void patch(person, { stage: n }); }}>
                    <b>{st.name}</b><span>{st.short}</span><i>{t.capShort(st.cap)}</i>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div class="desk-tools">
        <Nerve value={person.nerve} onChange={(n) => patch(person, { nerve: n })} />
        <label class={`clear-eyed ${person.clearEyed ? "on" : ""}`} title={t.clearEyedTip}>
          <input type="checkbox" checked={person.clearEyed} onChange={(e) => patch(person, { clearEyed: (e.target as HTMLInputElement).checked })} />
          <span class="switch" /><span>{t.clearEyed}</span>
        </label>
        <button class={`icon-btn dossier-toggle ${s.dossierOpen ? "on" : ""}`} aria-label={t.dossierFull} title={t.dossierFull}
          onClick={() => (window.innerWidth < 1180 ? setState({ drawer: s.drawer === "right" ? null : "right" }) : setState({ dossierOpen: !s.dossierOpen }))}>
          <Icon name="book" /><span class="only-wide">{t.dossier}</span>
        </button>
      </div>
    </header>
  );
}
