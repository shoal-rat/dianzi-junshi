import { render } from "preact";
import { useEffect } from "preact/hooks";
import { Sidebar } from "./ui/Sidebar";
import { Desk } from "./ui/Desk";
import { Dossier } from "./ui/Dossier";
import { Dialogs } from "./ui/Dialogs";
import { Seal, SealDefs, Brush } from "./ui/Seal";
import { boot, current, setState, useApp } from "./lib/store";

const theme = localStorage.getItem("junshi.theme");
if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);

function Welcome() {
  return (
    <div class="welcome">
      <div class="welcome-art" aria-hidden="true">
        <span class="welcome-vert">把聊天交给我</span>
        <Seal char="电子军师" size={132} tilt={-6} />
      </div>
      <div class="welcome-copy">
        <p class="kicker">恋爱聊天军师 · 资料只在这台电脑上</p>
        <h1>ta 发来一句话，<br />我给你三个锦囊。</h1>
        <Brush width={120} />
        <ol class="welcome-steps">
          <li><Seal char="一" size={30} tone="ink" /><div><b>建个档案</b><span>给 ta 起个代号就行，以前的截图可以一起丢进来</span></div></li>
          <li><Seal char="二" size={30} tone="ink" /><div><b>贴 ta 的话</b><span>文字、截图都行。我先扫梗、读语气，再看有没有戏</span></div></li>
          <li><Seal char="三" size={30} tone="ink" /><div><b>挑一句发</b><span>稳、撩、奇三条路，发完回来说一声，我会越来越懂 ta</span></div></li>
        </ol>
        <button class="btn btn-zhu big" onClick={() => setState({ dialog: { type: "new" } })}>建第一个档案</button>
      </div>
    </div>
  );
}

function Toast() {
  const s = useApp();
  if (!s.toast) return null;
  return <div class={`toast tone-${s.toast.tone}`} role="status" key={s.toast.id}>{s.toast.text}</div>;
}

function App() {
  const s = useApp();
  useEffect(() => { void boot(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && s.drawer) setState({ drawer: null }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.drawer]);
  const person = current();
  if (!s.booted) {
    return <div class="splash"><SealDefs /><Seal char="军" size={64} tilt={-6} /></div>;
  }
  return (
    <div class={`app ${person && s.dossierOpen ? "has-dossier" : ""} ${s.drawer ? `drawer-${s.drawer}` : ""}`}>
      <SealDefs />
      <Sidebar />
      <main class="desk">{person ? <Desk person={person} key={person.id} /> : <Welcome />}</main>
      {person && <Dossier person={person} />}
      <button class="scrim" aria-label="关闭抽屉" tabIndex={-1} onClick={() => setState({ drawer: null })} />
      <Dialogs />
      <Toast />
    </div>
  );
}

render(<App />, document.getElementById("root")!);
