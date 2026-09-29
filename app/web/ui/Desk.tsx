import { useEffect, useRef } from "preact/hooks";
import { Header } from "./Header";
import { Composer } from "./Composer";
import { Turn } from "./Turn";
import { Seal, Brush } from "./Seal";
import { setDraft, setState, useApp } from "../lib/store";
import { FACT_SLOTS, type PersonDTO } from "../../src/shared/domain";

function Blank({ person }: { person: PersonDTO }) {
  const s = useApp();
  const d = s.dossiers[person.id];
  const facts = d?.facts.filter((f) => f.status === "active") ?? [];
  const tries = [
    { label: "贴 ta 的最后一句", act: () => setDraft(person.id, { mode: "reply", text: "" }) },
    { label: "帮我看看我想发的", act: () => setDraft(person.id, { mode: "polish" }) },
    { label: "ta 到底有没有戏", act: () => setDraft(person.id, { mode: "odds" }) },
  ];
  return (
    <div class="blank">
      <Seal char={[...person.name][0]} size={72} tilt={-5} class="blank-seal" />
      <h2>和 {person.name} 的军帐</h2>
      <Brush width={80} />
      <p>把 ta 发来的话贴在下面，或者直接丢聊天截图。军师先读懂，再给你三个锦囊。</p>
      <div class="blank-tries">
        {tries.map((t) => <button key={t.label} class="chip" onClick={() => { t.act(); (document.querySelector(".composer textarea") as HTMLTextAreaElement | null)?.focus(); }}>{t.label}</button>)}
      </div>
      <div class="blank-know">
        {facts.length ? (
          <p>档案里已经记着 {facts.length} 条关于 ta 的事（{[...new Set(facts.map((f) => FACT_SLOTS[f.slot]))].slice(0, 4).join("、")}），每次都会带上。</p>
        ) : (
          <p>档案还是空的。有以前的截图或聊天，<button class="link" onClick={() => setState({ dialog: { type: "import" } })}>导进来</button>，军师会记住 ta 的生日、喜好和说话习惯。</p>
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
            <div class="turn pending"><div class="counsel"><div class="counsel-mark"><Seal char="军" size={30} tilt={-6} /></div><div class="thinking"><span class="ink-drop" />军师收到了…</div></div></div>
          )}
        </div>
      </div>
      <Composer person={person} />
    </>
  );
}
