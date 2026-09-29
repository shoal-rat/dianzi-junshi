import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { openPerson, setState, useApp } from "../lib/store";
import { ago } from "../lib/format";
import { T, uiLang } from "../lib/i18n";
import { labels } from "../../src/shared/domain";

export function Sidebar() {
  const s = useApp();
  const t = T();
  const L = labels(uiLang());
  const provider = s.settings?.providers.find((p) => p.kind === s.settings?.provider);
  const live = s.live;
  return (
    <aside class="roster" aria-label={t.dossier}>
      <div class="brand">
        <Seal char="电子军师" size={46} tilt={-4} class="brand-seal" />
        <div class="brand-words">
          <div class="brand-name">{t.brandName}</div>
          <div class="brand-sub">{t.brandSub}</div>
        </div>
      </div>

      <button class="btn btn-zhu roster-new" onClick={() => setState({ dialog: { type: "new" } })}>
        <Icon name="plus" size={16} /> {t.newProfile}
      </button>

      <div class="roster-label"><span>{t.roster}</span><i>{s.people.length}</i></div>
      <nav class="roster-list">
        {s.people.map((p) => {
          const active = p.id === s.currentId;
          const busy = live?.personId === p.id;
          const foreign = p.lang && p.lang !== uiLang();
          return (
            <button key={p.id} class={`roster-item ${active ? "active" : ""}`} onClick={() => openPerson(p.id)} aria-current={active ? "page" : undefined}>
              <span class="roster-avatar" data-stage={p.stage}>{[...p.name][0]}</span>
              <span class="roster-text">
                <span class="roster-name">{p.name}<em>{L.stage(p.stage).short}</em>{foreign && <i class="lang-badge">{t.langBadge[p.lang]}</i>}</span>
                <span class="roster-line">{busy ? t.thinkingShort : p.lastLine ?? t.neverChatted}</span>
              </span>
              <span class="roster-time">{busy ? <span class="dot-pulse" /> : ago(p.lastTurnAt ?? p.createdAt)}</span>
            </button>
          );
        })}
        {!s.people.length && <p class="roster-empty">{t.rosterEmpty1}<br />{t.rosterEmpty2}</p>}
      </nav>

      <button class={`conn ${provider?.ready ? "ready" : "warn"}`} onClick={() => setState({ dialog: { type: "settings" } })}>
        <span class="conn-dot" />
        <span class="conn-text">
          <b>{provider?.label ?? t.connNone}</b>
          <small>{provider ? (provider.kind === "demo" ? t.connDemo : provider.ready ? t.connReady : provider.detail) : t.connPick}</small>
        </span>
        <Icon name="gear" size={16} />
      </button>
    </aside>
  );
}
