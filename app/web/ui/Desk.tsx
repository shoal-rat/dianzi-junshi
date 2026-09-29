import { useEffect, useRef } from "preact/hooks";
import { Header } from "./Header";
import { Composer } from "./Composer";
import { Turn } from "./Turn";
import { Seal, Brush } from "./Seal";
import { setDraft, setState, useApp } from "../lib/store";
import { T, uiLang } from "../lib/i18n";
import { labels, type PersonDTO } from "../../src/shared/domain";

function Blank({ person }: { person: PersonDTO }) {
  const s = useApp();
  const d = s.dossiers[person.id];
  const t = T();
  const facts = d?.facts.filter((f) => f.status === "active") ?? [];
  const tries = [
    { label: t.blankTries[0], act: () => setDraft(person.id, { mode: "reply", text: "" }) },
    { label: t.blankTries[1], act: () => setDraft(person.id, { mode: "polish" }) },
    { label: t.blankTries[2], act: () => setDraft(person.id, { mode: "odds" }) },
  ];
  return (
    <div class="blank">
      <Seal char={[...person.name][0]} size={72} tilt={-5} class="blank-seal" />
      <h2>{t.blankTitle(person.name)}</h2>
      <Brush width={80} />
      <p>{t.blankBody}</p>
      <div class="blank-tries">
        {tries.map((x) => <button key={x.label} class="chip" onClick={() => { x.act(); (document.querySelector(".composer textarea") as HTMLTextAreaElement | null)?.focus(); }}>{x.label}</button>)}
      </div>
      <div class="blank-know">
        {facts.length ? (
          <p>{t.blankKnows(facts.length, [...new Set(facts.map((f) => labels(uiLang()).slots[f.slot]))].slice(0, 4).join(uiLang() === "en" ? ", " : "、"))}</p>
        ) : (
          <p>{t.blankEmpty1}<button class="link" onClick={() => setState({ dialog: { type: "import" } })}>{t.blankEmptyLink}</button>{t.blankEmpty2}</p>
        )}
      </div>
    </div>
  );
}

export function Desk({ person }: { person: PersonDTO }) {
  const s = useApp();
  const turns = s.turns[person.id] ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const live = s.live?.personId === person.id ? s.live : null;

  useEffect(() => {
    stick.current = true;
    requestAnimationFrame(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; });
  }, [person.id, turns.length]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [live?.output, live?.status]);

  return (
    <>
      <Header person={person} />
      <div class="thread" ref={scroller} onScroll={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}>
        <div class="thread-inner">
          {turns.length === 0 && !live ? <Blank person={person} /> : turns.map((t) => (
            <Turn key={t.id} turn={t} person={person} live={live && live.turnId === t.id ? live : null} />
          ))}
          {live && !live.turnId && (
            <div class="turn pending"><div class="counsel"><div class="counsel-mark"><Seal char="军" size={30} tilt={-6} /></div><div class="thinking"><span class="ink-drop" />{T().received}</div></div></div>
          )}
        </div>
      </div>
      <Composer person={person} />
    </>
  );
}
