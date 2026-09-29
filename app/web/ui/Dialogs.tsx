import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { Nerve } from "./Header";
import { api, uploadImage } from "../lib/api";
import { current, openPerson, refreshDossier, refreshPeople, refreshSettings, reloadTurns, reportError, setState, toast, useApp, watchJob } from "../lib/store";
import { T, uiLang } from "../lib/i18n";
import { labels, SEAL_EN, type ChatLang, type Gender, type ImageRef, type Outcome, type ProviderKind, type ProviderStatusDTO, type SignalKey } from "../../src/shared/domain";
import { parseAnswer } from "../../src/shared/contract";

function Dialog({ title, kicker, children, onClose, wide }: { title: string; kicker?: string; children: ComponentChildren; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    const cancel = (e: Event) => { e.preventDefault(); onClose(); };
    el?.addEventListener("cancel", cancel);
    return () => el?.removeEventListener("cancel", cancel);
  }, []);
  return (
    <dialog ref={ref} class={`dlg ${wide ? "wide" : ""}`} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div class="dlg-sheet">
        <header class="dlg-head">
          <div>{kicker && <span class="dlg-kicker">{kicker}</span>}<h2>{title}</h2></div>
          <button class="icon-btn" aria-label={T().close} onClick={onClose}><Icon name="x" /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

const close = () => setState({ dialog: null });

function Drop({ files, onFiles, hint }: { files: File[]; onFiles: (f: File[]) => void; hint: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div class={`drop ${over ? "over" : ""}`} tabIndex={0} role="button" onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...files, ...[...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"))]); }}>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
        onChange={(e) => { onFiles([...files, ...[...((e.target as HTMLInputElement).files ?? [])]]); (e.target as HTMLInputElement).value = ""; }} />
      <Icon name="image" size={22} />
      <b>{files.length ? T().dropPicked(files.length) : T().dropPick}</b>
      <small>{hint}</small>
    </div>
  );
}

async function uploadAll(personId: string, files: File[], origin: "import" | "feedback"): Promise<ImageRef[]> {
  const out: ImageRef[] = [];
  for (const f of files) {
    try { out.push(await uploadImage(personId, f, origin)); } catch (e) { reportError(e); }
  }
  return out;
}

function GenderPick({ value, onChange, label }: { value: Gender; onChange: (g: Gender) => void; label: string }) {
  return (
    <div class="field"><span>{label}</span>
      <div class="stage-chips">
        {(["f", "m", ""] as Gender[]).map((g) => (
          <button type="button" key={g || "none"} class={`chip ${value === g ? "cur" : ""}`} onClick={() => onChange(g)}>{labels(uiLang()).genders[g].label}</button>
        ))}
      </div>
    </div>
  );
}

function LangPick({ value, onChange }: { value: ChatLang; onChange: (l: ChatLang) => void }) {
  const t = T();
  return (
    <div class="field"><span>{t.chatLangLabel}</span>
      <div class="stage-chips">
        {(["", "zh", "en"] as ChatLang[]).map((l) => (
          <button type="button" key={l || "follow"} class={`chip ${value === l ? "cur" : ""}`} lang={l === "zh" ? "zh-CN" : l === "en" ? "en" : undefined} onClick={() => onChange(l)}>{t.chatLangs[l]}</button>
        ))}
      </div>
      <small>{t.chatLangHint}</small>
    </div>
  );
}

function NewPerson() {
  const t = T();
  const L = labels(uiLang());
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("");
  const [lang, setLang] = useState<ChatLang>("");
  const [stage, setStage] = useState(1);
  const [nerve, setNerve] = useState(2);
  const [clearEyed, setClearEyed] = useState(false);
  const [history, setHistory] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) { toast(t.nameNeeded, "zhu"); return; }
    setBusy(true);
    try {
      const { person, job } = await api.createPerson({ name, gender, lang, stage, nerve, clearEyed, history });
      if (files.length) {
        const refs = await uploadAll(person.id, files, "import");
        if (refs.length) { const j = await api.importStuff(person.id, { imageIds: refs.map((r) => r.id) }); watchJob(person.id, j.id); }
      }
      if (job) watchJob(person.id, job.id);
      await refreshPeople();
      await openPerson(person.id);
      close();
      toast(files.length || history.trim() ? t.createdBg : t.created, "jade");
    } catch (err) { reportError(err); } finally { setBusy(false); }
  }
  return (
    <Dialog title={t.newTitle} kicker={t.newKicker} onClose={close} wide>
      <form class="dlg-body two" onSubmit={submit}>
        <div>
          <label class="field"><span>{t.nameLabel}</span>
            <input value={name} maxLength={40} autoFocus placeholder={t.namePh} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <GenderPick value={gender} onChange={setGender} label={t.genderLabel} />
          <div class="field"><span>{t.stageLabel}</span>
            <div class="stage-chips">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <button type="button" key={n} class={`chip ${stage === n ? "cur" : ""}`} onClick={() => setStage(n)}>{L.stage(n).short}</button>)}
            </div>
            <small>{t.stageHint}</small>
          </div>
          <div class="field"><span>{t.nerve}</span><Nerve value={nerve} onChange={setNerve} compact /><small>{t.nerveHint}</small></div>
          <label class="check"><input type="checkbox" checked={clearEyed} onChange={(e) => setClearEyed((e.target as HTMLInputElement).checked)} />
            <span><b>{t.clearEyedLabel}</b><small>{t.clearEyedHint}</small></span>
          </label>
        </div>
        <div>
          <LangPick value={lang} onChange={setLang} />
          <label class="field"><span>{t.historyLabel} <i>{t.optional}</i></span>
            <textarea rows={6} value={history} placeholder={t.historyPh} onInput={(e) => setHistory((e.target as HTMLTextAreaElement).value)} />
          </label>
          <Drop files={files} onFiles={setFiles} hint={t.dropHintNew} />
        </div>
        <footer class="dlg-foot">
          <span class="privacy"><Icon name="eye" size={14} />{t.privacy}</span>
          <button type="button" class="btn btn-line" onClick={close}>{t.later}</button>
          <button class="btn btn-zhu" disabled={busy}>{busy ? t.creating : t.create}</button>
        </footer>
      </form>
    </Dialog>
  );
}

function PersonEdit() {
  const person = current();
  const [name, setName] = useState(person?.name ?? "");
  const [gender, setGender] = useState<Gender>(person?.gender ?? "");
  const [note, setNote] = useState(person?.note ?? "");
  const [lang, setLang] = useState<ChatLang>(person?.lang ?? "");
  const t = T();
  if (!person) return null;
  async function save(e: Event) {
    e.preventDefault();
    try { await api.updatePerson(person!.id, { name, gender, lang, note }); await refreshPeople(); close(); } catch (err) { reportError(err); }
  }
  async function remove() {
    if (!confirm(t.confirmDeletePerson(person!.name))) return;
    try {
      await api.deletePerson(person!.id);
      await refreshPeople();
      const next = (await api.people())[0];
      if (next) await openPerson(next.id); else setState({ currentId: null });
      close();
    } catch (err) { reportError(err); }
  }
  return (
    <Dialog title={person.name} kicker={t.personKicker} onClose={close}>
      <form class="dlg-body" onSubmit={save}>
        <label class="field"><span>{t.nameLabel}</span><input value={name} maxLength={40} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <GenderPick value={gender} onChange={setGender} label={t.genderLabel} />
        <LangPick value={lang} onChange={setLang} />
        <label class="field"><span>{t.noteLabel}</span>
          <textarea rows={4} value={note} placeholder={t.notePh} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
          <small>{t.noteHint}</small>
        </label>
        <footer class="dlg-foot">
          <button type="button" class="btn btn-danger" onClick={remove}><Icon name="trash" size={15} />{t.deletePerson}</button>
          <span class="grow" />
          <button type="button" class="btn btn-line" onClick={close}>{t.cancel}</button>
          <button class="btn btn-zhu">{t.save}</button>
        </footer>
      </form>
    </Dialog>
  );
}

function ImportDialog() {
  const person = current();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const t = T();
  if (!person) return null;
  async function submit(e: Event) {
    e.preventDefault();
    if (!text.trim() && !files.length) { toast(t.importNeedSomething, "zhu"); return; }
    setBusy(true);
    try {
      if (text.trim()) { const j = await api.importStuff(person!.id, { text }); watchJob(person!.id, j.id); }
      if (files.length) {
        const refs = await uploadAll(person!.id, files, "import");
        if (refs.length) { const j = await api.importStuff(person!.id, { imageIds: refs.map((r) => r.id) }); watchJob(person!.id, j.id); }
      }
      await refreshDossier(person!.id);
      close();
      toast(t.importQueued, "jade");
    } catch (err) { reportError(err); } finally { setBusy(false); }
  }
  return (
    <Dialog title={t.importTitle(person.name)} kicker={t.importKicker} onClose={close} wide>
      <form class="dlg-body two" onSubmit={submit}>
        <label class="field"><span>{t.importTextLabel}</span>
          <textarea rows={9} value={text} placeholder={t.importTextPh} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        </label>
        <Drop files={files} onFiles={setFiles} hint={t.importDropHint} />
        <footer class="dlg-foot">
          <span class="privacy"><Icon name="eye" size={14} />{t.privacyImport}</span>
          <button type="button" class="btn btn-line" onClick={close}>{t.cancel}</button>
          <button class="btn btn-zhu" disabled={busy}>{busy ? t.uploading : t.startImport}</button>
        </footer>
      </form>
    </Dialog>
  );
}

function ProviderFields({ p, onSaved }: { p: ProviderStatusDTO; onSaved: () => void }) {
  const [model, setModel] = useState(p.model ?? "");
  const [base, setBase] = useState(p.baseUrl ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const t = T();
  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.saveSettings({ provider: p.kind, providers: { [p.kind]: { model, baseUrl: base } }, key: key.trim() ? { kind: p.kind, value: key.trim() } : undefined });
      setKey("");
      onSaved();
      toast(t.switchedTo(p.label), "jade");
    } catch (err) { reportError(err); } finally { setBusy(false); }
  }
  return (
    <form class="prov-fields" onSubmit={save}>
      {(p.models.length > 0 || p.kind === "custom" || p.kind === "codex") && (
        <label class="field"><span>{t.model}</span>
          {p.models.length > 0 && p.kind !== "custom" ? (
            <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}>
              {p.kind === "claude-code" ? null : <option value="">{t.modelDefault(p.models[0])}</option>}
              {p.models.map((m) => <option key={m} value={m}>{m || t.modelFollowCC}</option>)}
            </select>
          ) : (
            <input value={model} placeholder={p.kind === "codex" ? t.modelCodexPh : t.modelPh} onInput={(e) => setModel((e.target as HTMLInputElement).value)} />
          )}
        </label>
      )}
      {(p.kind === "custom" || p.kind === "claude") && (
        <label class="field"><span>{t.baseUrl} {p.kind === "claude" && <i>{t.baseUrlHint}</i>}</span>
          <input value={base} placeholder={p.kind === "custom" ? "http://127.0.0.1:1234/v1" : "https://api.anthropic.com"} onInput={(e) => setBase((e.target as HTMLInputElement).value)} />
        </label>
      )}
      {p.needsKey && (
        <label class="field"><span>{t.apiKey} {p.hasKey && <i>{t.apiKeySaved}</i>}</span>
          <input type="password" autoComplete="off" value={key} placeholder={p.hasKey ? "••••••••" : t.apiKeyPh} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
        </label>
      )}
      <div class="prov-actions">
        {p.needsKey && p.hasKey && <button type="button" class="link" onClick={async () => { await api.saveSettings({ key: { kind: p.kind, value: null } }); onSaved(); }}>{t.deleteKey}</button>}
        <button class="btn btn-zhu" disabled={busy || (p.needsKey && !p.hasKey && !key.trim())}>{t.useThis}</button>
      </div>
    </form>
  );
}

function SettingsDialog() {
  const s = useApp();
  const settings = s.settings;
  const [picked, setPicked] = useState<ProviderKind>(settings?.provider ?? "demo");
  const [theme, setTheme] = useState(() => localStorage.getItem("junshi.theme") ?? "auto");
  useEffect(() => { void refreshSettings(); }, []);
  const t = T();
  if (!settings) return null;
  const chosen = settings.providers.find((p) => p.kind === picked);
  function applyTheme(t: string) {
    setTheme(t);
    localStorage.setItem("junshi.theme", t);
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
  }
  const local = settings.providers.filter((p) => p.local && p.kind !== "demo");
  const cloud = settings.providers.filter((p) => !p.local);
  const demo = settings.providers.find((p) => p.kind === "demo")!;
  const card = (p: ProviderStatusDTO) => (
    <button key={p.kind} type="button" class={`prov ${picked === p.kind ? "picked" : ""} ${settings.provider === p.kind ? "active" : ""} ${p.ready ? "ready" : ""}`} onClick={() => setPicked(p.kind)}>
      <span class="prov-dot" />
      <b>{p.label}</b>
      <small>{p.detail}</small>
      {settings.provider === p.kind && <Seal char="用" size={20} tone="jade" class="prov-seal" title={t.connReady} />}
    </button>
  );
  return (
    <Dialog title={t.settingsTitle} kicker={t.settingsKicker} onClose={close} wide>
      <div class="dlg-body">
        <h4 class="dlg-sub">{t.localAI}<small>{t.localAIHint}</small></h4>
        <div class="prov-grid">{local.map(card)}</div>
        <h4 class="dlg-sub">{t.apiAI}<small>{t.apiAIHint}</small></h4>
        <div class="prov-grid">{cloud.map(card)}{card(demo)}</div>
        {chosen && (
          <div class="prov-detail">
            <ProviderFields key={chosen.kind} p={chosen} onSaved={() => void refreshSettings()} />
            {!chosen.needsKey && chosen.kind !== "demo" && !chosen.ready && <p class="note">{chosen.detail}</p>}
          </div>
        )}
        <div class="settings-row">
          <div><b>{t.uiLang}</b><small>{t.uiLangHint}</small></div>
          <select value={settings.language} onChange={async (e) => { await api.saveSettings({ language: (e.target as HTMLSelectElement).value as "auto" | "zh" | "en" }); void refreshSettings(); }}>
            {(["auto", "zh", "en"] as const).map((v) => <option key={v} value={v}>{t.uiLangs[v]}</option>)}
          </select>
        </div>
        <div class="settings-row">
          <div>
            <b>{t.depth}</b>
            <small>{t.depthHint}</small>
          </div>
          <select value={settings.depth} onChange={async (e) => { await api.saveSettings({ depth: (e.target as HTMLSelectElement).value as "fast" | "balanced" | "deep" }); void refreshSettings(); }}>
            {(["fast", "balanced", "deep"] as const).map((v) => <option key={v} value={v}>{t.depths[v]}</option>)}
          </select>
        </div>
        <div class="settings-row">
          <div>
            <b>{t.semantic}</b>
            <small>{settings.semantic.detail}{t.semanticHint}</small>
          </div>
          <select value={settings.semantic.mode} onChange={async (e) => { await api.saveSettings({ semantic: (e.target as HTMLSelectElement).value as "auto" | "off" }); void refreshSettings(); }}>
            {(["auto", "off"] as const).map((v) => <option key={v} value={v}>{t.semantics[v]}</option>)}
          </select>
        </div>
        <div class="settings-row">
          <div><b>{t.me}</b><small>{t.meHint}</small></div>
          <select value={settings.me} onChange={async (e) => { await api.saveSettings({ me: (e.target as HTMLSelectElement).value }); void refreshSettings(); }}>
            {(["", "f", "m"] as Gender[]).map((g) => <option key={g} value={g}>{labels(uiLang()).genders[g].label}</option>)}
          </select>
        </div>
        <div class="settings-row">
          <div><b>{t.paper}</b><small>{t.paperHint}</small></div>
          <select value={theme} onChange={(e) => applyTheme((e.target as HTMLSelectElement).value)}>
            {(["auto", "light", "dark"] as const).map((v) => <option key={v} value={v}>{t.papers[v]}</option>)}
          </select>
        </div>
        <p class="note small">{t.dataAt} <code>{settings.home}</code> · {t.brandName} {settings.version}</p>
      </div>
    </Dialog>
  );
}

function FeedbackDialog({ turnId, planIndex }: { turnId: string; planIndex?: number }) {
  const s = useApp();
  const person = current();
  const turn = person ? (s.turns[person.id] ?? []).find((t) => t.id === turnId) : undefined;
  const parsed = turn ? parseAnswer(turn.output) : null;
  const plan = parsed?.plans.find((p) => p.index === planIndex) ?? parsed?.plans.find((p) => (turn?.copied ?? []).includes(p.index)) ?? parsed?.plans[0];
  const prev = turn?.outcome;
  const [sent, setSent] = useState(prev?.sent ?? plan?.lines.join("\n") ?? "");
  const [reply, setReply] = useState(prev?.reply ?? "");
  const [result, setResult] = useState<Outcome | null>(prev?.result ?? null);
  const [delay, setDelay] = useState(prev?.delayHours ?? 6);
  const [signals, setSignals] = useState<Partial<Record<SignalKey, boolean>>>(prev?.signals ?? {});
  const [files, setFiles] = useState<File[]>([]);
  const [guessing, setGuessing] = useState(false);
  const [reason, setReason] = useState("");
  const t = T();
  const L = labels(uiLang());
  if (!person || !turn) return null;
  async function guess() {
    setGuessing(true);
    try {
      const refs = files.length ? await uploadAll(person!.id, files, "feedback") : [];
      const g = await api.guessOutcome(person!.id, { sent, reply, imageIds: refs.map((r) => r.id) });
      setResult(g.result); setDelay(g.delayHours); setSignals(g.signals); setReason(g.reason);
      if (!reply.trim() && g.reply) setReply(g.reply);
    } catch (e) { reportError(e); } finally { setGuessing(false); }
  }
  async function save(e: Event) {
    e.preventDefault();
    if (!result) { toast(t.pickReaction, "zhu"); return; }
    try {
      await api.recordOutcome(person!.id, { turnId, planIndex: plan?.index, seal: plan?.seal, suggested: plan?.lines.join("\n"), sent, reply, result, delayHours: delay, signals });
      await Promise.all([reloadTurns(person!.id), refreshDossier(person!.id)]);
      close();
      toast(t.logged, "jade");
    } catch (err) { reportError(err); }
  }
  return (
    <Dialog title={t.feedbackTitle} kicker={t.feedbackKicker} onClose={close} wide>
      <form class="dlg-body two" onSubmit={save}>
        <div>
          <label class="field"><span>{t.sentLabel} {plan && <i>{t.sentHint(uiLang() === "en" ? SEAL_EN[plan.seal] ?? plan.seal : plan.seal)}</i>}</span>
            <textarea rows={3} value={sent} onInput={(e) => setSent((e.target as HTMLTextAreaElement).value)} />
          </label>
          <label class="field"><span>{t.replyLabel} <i>{t.replyHint}</i></span>
            <textarea rows={4} value={reply} placeholder={t.replyPh} onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} />
          </label>
          <Drop files={files} onFiles={setFiles} hint={t.replyDrop} />
          <button type="button" class="btn btn-line wide" disabled={guessing || (!reply.trim() && !files.length)} onClick={guess}>
            <Icon name="spark" size={15} />{guessing ? t.guessing : t.guess}
          </button>
          {reason && <p class="note">{reason}</p>}
        </div>
        <div>
          <div class="field"><span>{t.reactionLabel}</span>
            <div class="outcomes">
              {(Object.keys(L.outcomes) as Outcome[]).map((r) => (
                <button type="button" key={r} class={`outcome r-${r} ${result === r ? "cur" : ""}`} onClick={() => setResult(r)}>
                  <b>{L.outcomes[r].label}</b><small>{L.outcomes[r].hint}</small>
                </button>
              ))}
            </div>
          </div>
          <label class="field"><span>{t.delayLabel}</span>
            <select value={delay} onChange={(e) => setDelay(Number((e.target as HTMLSelectElement).value))}>
              {t.delays.map(([v, label]) => <option key={v} value={Number(v)}>{label}</option>)}
            </select>
          </label>
          <div class="field"><span>{t.signalsLabel}</span>
            <div class="signals">
              {(Object.keys(L.signals) as SignalKey[]).map((k) => (
                <label key={k} class={`chip ${signals[k] ? "cur" : ""}`}>
                  <input type="checkbox" checked={Boolean(signals[k])} onChange={(e) => setSignals({ ...signals, [k]: (e.target as HTMLInputElement).checked })} />{L.signals[k]}
                </label>
              ))}
            </div>
          </div>
        </div>
        <footer class="dlg-foot">
          {prev && <button type="button" class="link" onClick={async () => { await api.deleteOutcome(person.id, prev.id); await reloadTurns(person.id); await refreshDossier(person.id); close(); }}>{t.deleteOutcome}</button>}
          <span class="grow" />
          <button type="button" class="btn btn-line" onClick={close}>{t.notNow}</button>
          <button class="btn btn-zhu">{t.logIt}</button>
        </footer>
      </form>
    </Dialog>
  );
}

export function Dialogs() {
  const s = useApp();
  const d = s.dialog;
  if (!d) return null;
  if (d.type === "new") return <NewPerson />;
  if (d.type === "person") return <PersonEdit />;
  if (d.type === "import") return <ImportDialog />;
  if (d.type === "settings") return <SettingsDialog />;
  if (d.type === "feedback") return <FeedbackDialog turnId={d.turnId} planIndex={d.planIndex} />;
  return null;
}
