import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { openPerson, setState, useApp } from "../lib/store";
import { ago } from "../lib/format";
import { stageOf } from "../../src/shared/domain";

export function Sidebar() {
  const s = useApp();
  const provider = s.settings?.providers.find((p) => p.kind === s.settings?.provider);
  const live = s.live;
  return (
    <aside class="roster" aria-label="档案">
      <div class="brand">
        <Seal char="电子军师" size={46} tilt={-4} class="brand-seal" />
        <div class="brand-words">
          <div class="brand-name">电子军师</div>
          <div class="brand-sub">替你看聊天 · 给你出锦囊</div>
        </div>
      </div>

      <button class="btn btn-zhu roster-new" onClick={() => setState({ dialog: { type: "new" } })}>
        <Icon name="plus" size={16} /> 新建档案
      </button>

      <div class="roster-label"><span>名册</span><i>{s.people.length}</i></div>
      <nav class="roster-list">
        {s.people.map((p) => {
          const active = p.id === s.currentId;
          const busy = live?.personId === p.id;
          return (
            <button key={p.id} class={`roster-item ${active ? "active" : ""}`} onClick={() => openPerson(p.id)} aria-current={active ? "page" : undefined}>
              <span class="roster-avatar" data-stage={p.stage}>{[...p.name][0]}</span>
              <span class="roster-text">
                <span class="roster-name">{p.name}<em>{stageOf(p.stage).short}</em></span>
                <span class="roster-line">{busy ? "军师在想…" : p.lastLine ?? "还没聊过"}</span>
              </span>
              <span class="roster-time">{busy ? <span class="dot-pulse" /> : ago(p.lastTurnAt ?? p.createdAt)}</span>
            </button>
          );
        })}
        {!s.people.length && <p class="roster-empty">还没有档案。<br />给 ta 起个代号就能开始。</p>}
      </nav>

      <button class={`conn ${provider?.ready ? "ready" : "warn"}`} onClick={() => setState({ dialog: { type: "settings" } })}>
        <span class="conn-dot" />
        <span class="conn-text">
          <b>{provider?.label ?? "未连接"}</b>
          <small>{provider ? (provider.kind === "demo" ? "示范回答，点这里连 AI" : provider.ready ? "已连接" : provider.detail) : "点这里选一个 AI"}</small>
        </span>
        <Icon name="gear" size={16} />
      </button>
    </aside>
  );
}
