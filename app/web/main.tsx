import { render } from "preact";
import { useEffect } from "preact/hooks";
import { Sidebar } from "./ui/Sidebar";
import { Desk } from "./ui/Desk";
import { Dossier } from "./ui/Dossier";
import { Dialogs } from "./ui/Dialogs";
import { Seal, SealDefs, Brush } from "./ui/Seal";
import { boot, current, setState, useApp } from "./lib/store";
import { setUiLang, T } from "./lib/i18n";

const theme = localStorage.getItem("junshi.theme");
if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
// 服务端说了算；启动前先按浏览器语言猜一个，免得标题闪一下
setUiLang(/^zh\b/i.test(navigator.language) ? "zh" : "en");

function Welcome() {
  const t = T();
  return (
    <div class="welcome">
      <div class="welcome-art" aria-hidden="true">
        <span class="welcome-vert">{t.welcomeVert}</span>
        <Seal char="电子军师" size={132} tilt={-6} />
      </div>
      <div class="welcome-copy">
        <p class="kicker">{t.welcomeKicker}</p>
        <h1>{t.welcomeTitle[0]}<br />{t.welcomeTitle[1]}</h1>
        <Brush width={120} />
        <ol class="welcome-steps">
          {t.welcomeSteps.map(([title, body], i) => (
            <li key={i}><Seal char={t.welcomeStepSeals[i]} size={30} tone="ink" /><div><b>{title}</b><span>{body}</span></div></li>
          ))}
        </ol>
        <button class="btn btn-zhu big" onClick={() => setState({ dialog: { type: "new" } })}>{t.welcomeCta}</button>
        {t.welcomeFootnote && <p class="welcome-foot">{t.welcomeFootnote}</p>}
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
      <button class="scrim" aria-label={T().scrim} tabIndex={-1} onClick={() => setState({ drawer: null })} />
      <Dialogs />
      <Toast />
    </div>
  );
}

render(<App />, document.getElementById("root")!);
