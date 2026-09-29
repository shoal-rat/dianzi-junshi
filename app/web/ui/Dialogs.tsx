import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Seal } from "./Seal";
import { Icon } from "./Icon";
import { Nerve } from "./Header";
import { api, uploadImage } from "../lib/api";
import { current, openPerson, refreshDossier, refreshPeople, refreshSettings, reloadTurns, reportError, setState, toast, useApp, watchJob } from "../lib/store";
import { GENDERS, OUTCOMES, SIGNALS, STAGES, type Gender, type ImageRef, type Outcome, type ProviderKind, type ProviderStatusDTO, type SignalKey } from "../../src/shared/domain";
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
          <button class="icon-btn" aria-label="关闭" onClick={onClose}><Icon name="x" /></button>
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
      <b>{files.length ? `已选 ${files.length} 张截图` : "拖进来，或者点这里选截图"}</b>
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
          <button type="button" key={g || "none"} class={`chip ${value === g ? "cur" : ""}`} onClick={() => onChange(g)}>{GENDERS[g].label}</button>
        ))}
      </div>
    </div>
  );
}

function NewPerson() {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("");
  const [stage, setStage] = useState(1);
  const [nerve, setNerve] = useState(2);
  const [clearEyed, setClearEyed] = useState(false);
  const [history, setHistory] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) { toast("给 ta 起个称呼，代号也行", "zhu"); return; }
    setBusy(true);
    try {
      const { person, job } = await api.createPerson({ name, gender, stage, nerve, clearEyed, history });
      if (files.length) {
        const refs = await uploadAll(person.id, files, "import");
        if (refs.length) { const j = await api.importStuff(person.id, { imageIds: refs.map((r) => r.id) }); watchJob(person.id, j.id); }
      }
      if (job) watchJob(person.id, job.id);
      await refreshPeople();
      await openPerson(person.id);
      close();
      toast(files.length || history.trim() ? "建好了，旧资料在后台整理，你可以先开始聊" : "建好了", "jade");
    } catch (err) { reportError(err); } finally { setBusy(false); }
  }
  return (
    <Dialog title="新建档案" kicker="一分钟" onClose={close} wide>
      <form class="dlg-body two" onSubmit={submit}>
        <div>
          <label class="field"><span>怎么称呼 ta</span>
            <input value={name} maxLength={40} autoFocus placeholder="昵称、备注名、代号都行" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <GenderPick value={gender} onChange={setGender} label="ta 是" />
          <div class="field"><span>你俩现在到哪一步</span>
            <div class="stage-chips">
              {STAGES.map((s) => <button type="button" key={s.n} class={`chip ${stage === s.n ? "cur" : ""}`} onClick={() => setStage(s.n)}>{s.short}</button>)}
            </div>
            <small>拿不准就选「暧昧」，军师会用聊天里的证据自己校准</small>
          </div>
          <div class="field"><span>胆量</span><Nerve value={nerve} onChange={setNerve} compact /><small>越敢，锦囊越直接；判断本身不变</small></div>
          <label class="check"><input type="checkbox" checked={clearEyed} onChange={(e) => setClearEyed((e.target as HTMLInputElement).checked)} />
            <span><b>打开清醒提醒</b><small>ta 明显只是吊着你时，军师会像朋友一样直接拦住你</small></span>
          </label>
        </div>
        <div>
          <label class="field"><span>以前的聊天 <i>可选</i></span>
            <textarea rows={6} value={history} placeholder="贴以前的聊天、你记得的细节（生日、喜好、说过的话）……多长都行" onInput={(e) => setHistory((e.target as HTMLTextAreaElement).value)} />
          </label>
          <Drop files={files} onFiles={setFiles} hint="聊天、朋友圈、小红书截图都行，数量不限，后台一张张整理" />
        </div>
        <footer class="dlg-foot">
          <span class="privacy"><Icon name="eye" size={14} />都存在这台电脑上</span>
          <button type="button" class="btn btn-line" onClick={close}>算了</button>
          <button class="btn btn-zhu" disabled={busy}>{busy ? "在建…" : "建好，开始"}</button>
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
  if (!person) return null;
  async function save(e: Event) {
    e.preventDefault();
    try { await api.updatePerson(person!.id, { name, gender, note }); await refreshPeople(); close(); } catch (err) { reportError(err); }
  }
  async function remove() {
    if (!confirm(`删掉「${person!.name}」的档案？聊天、截图、记忆会一起删掉，恢复不了。`)) return;
    try {
      await api.deletePerson(person!.id);
      await refreshPeople();
      const next = (await api.people())[0];
      if (next) await openPerson(next.id); else setState({ currentId: null });
      close();
    } catch (err) { reportError(err); }
  }
  return (
    <Dialog title={person.name} kicker="档案设置" onClose={close}>
      <form class="dlg-body" onSubmit={save}>
        <label class="field"><span>称呼</span><input value={name} maxLength={40} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <GenderPick value={gender} onChange={setGender} label="ta 是" />
        <label class="field"><span>给军师的备注</span>
          <textarea rows={4} value={note} placeholder="比如：同事，不想让别人知道；她说过不喜欢被催" onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
          <small>每次都会带给军师</small>
        </label>
        <footer class="dlg-foot">
          <button type="button" class="btn btn-danger" onClick={remove}><Icon name="trash" size={15} />删掉这个档案</button>
          <span class="grow" />
          <button type="button" class="btn btn-line" onClick={close}>取消</button>
          <button class="btn btn-zhu">保存</button>
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
  if (!person) return null;
  async function submit(e: Event) {
    e.preventDefault();
    if (!text.trim() && !files.length) { toast("贴点文字或者选几张截图", "zhu"); return; }
    setBusy(true);
    try {
      if (text.trim()) { const j = await api.importStuff(person!.id, { text }); watchJob(person!.id, j.id); }
      if (files.length) {
        const refs = await uploadAll(person!.id, files, "import");
        if (refs.length) { const j = await api.importStuff(person!.id, { imageIds: refs.map((r) => r.id) }); watchJob(person!.id, j.id); }
      }
      await refreshDossier(person!.id);
      close();
      toast("收到，在后台一条条整理，整理好的会进档案卡", "jade");
    } catch (err) { reportError(err); } finally { setBusy(false); }
  }
  return (
    <Dialog title={`给 ${person.name} 补资料`} kicker="导入" onClose={close} wide>
      <form class="dlg-body two" onSubmit={submit}>
        <label class="field"><span>旧聊天或笔记</span>
          <textarea rows={9} value={text} placeholder="从微信复制出来的聊天记录、你记下的细节……原文会完整保存，按需要找回" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        </label>
        <Drop files={files} onFiles={setFiles} hint="一张张交给 AI 看，抄下对话、记下关于 ta 的事实；同一张图传两次只算一次" />
        <footer class="dlg-foot">
          <span class="privacy"><Icon name="eye" size={14} />原图和原文只存在这台电脑上</span>
          <button type="button" class="btn btn-line" onClick={close}>取消</button>
          <button class="btn btn-zhu" disabled={busy}>{busy ? "在上传…" : "开始整理"}</button>
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
  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.saveSettings({ provider: p.kind, providers: { [p.kind]: { model, baseUrl: base } }, key: key.trim() ? { kind: p.kind, value: key.trim() } : undefined });
      setKey("");
      onSaved();
      toast(`改用 ${p.label}`, "jade");
    } catch (err) { reportError(err); } finally { setBusy(false); }
  }
  return (
    <form class="prov-fields" onSubmit={save}>
      {(p.models.length > 0 || p.kind === "custom" || p.kind === "codex") && (
        <label class="field"><span>模型</span>
          {p.models.length > 0 && p.kind !== "custom" ? (
            <select value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}>
              {p.kind === "claude-code" ? null : <option value="">默认（{p.models[0]}）</option>}
              {p.models.map((m) => <option key={m} value={m}>{m || "跟随 Claude Code 的设置"}</option>)}
            </select>
          ) : (
            <input value={model} placeholder={p.kind === "codex" ? "留空就用 Codex 的默认模型" : "模型名"} onInput={(e) => setModel((e.target as HTMLInputElement).value)} />
          )}
        </label>
      )}
      {(p.kind === "custom" || p.kind === "claude") && (
        <label class="field"><span>接口地址 {p.kind === "claude" && <i>一般不用填</i>}</span>
          <input value={base} placeholder={p.kind === "custom" ? "http://127.0.0.1:1234/v1" : "https://api.anthropic.com"} onInput={(e) => setBase((e.target as HTMLInputElement).value)} />
        </label>
      )}
      {p.needsKey && (
        <label class="field"><span>API Key {p.hasKey && <i>已保存在系统钥匙串，不改就留空</i>}</span>
          <input type="password" autoComplete="off" value={key} placeholder={p.hasKey ? "••••••••" : "粘贴 Key"} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
        </label>
      )}
      <div class="prov-actions">
        {p.needsKey && p.hasKey && <button type="button" class="link" onClick={async () => { await api.saveSettings({ key: { kind: p.kind, value: null } }); onSaved(); }}>删掉 Key</button>}
        <button class="btn btn-zhu" disabled={busy || (p.needsKey && !p.hasKey && !key.trim())}>用这个</button>
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
      {settings.provider === p.kind && <Seal char="用" size={20} tone="jade" class="prov-seal" />}
    </button>
  );
  return (
    <Dialog title="连接与设置" kicker="AI 连接" onClose={close} wide>
      <div class="dlg-body">
        <h4 class="dlg-sub">本机已登录的 AI<small>不用填 Key，额度用你自己的账号</small></h4>
        <div class="prov-grid">{local.map(card)}</div>
        <h4 class="dlg-sub">API<small>Key 只存在系统钥匙串里</small></h4>
        <div class="prov-grid">{cloud.map(card)}{card(demo)}</div>
        {chosen && (
          <div class="prov-detail">
            <ProviderFields key={chosen.kind} p={chosen} onSaved={() => void refreshSettings()} />
            {!chosen.needsKey && chosen.kind !== "demo" && !chosen.ready && <p class="note">{chosen.detail}</p>}
          </div>
        )}
        <div class="settings-row">
          <div>
            <b>想多深</b>
            <small>快：少等一半，适合日常接话；细：多想一会儿，适合吵架、挑明这种关键时刻。Codex / Claude Code 要等整段写完才显示，选「快」体感差别最大。</small>
          </div>
          <select value={settings.depth} onChange={async (e) => { await api.saveSettings({ depth: (e.target as HTMLSelectElement).value as "fast" | "balanced" | "deep" }); void refreshSettings(); }}>
            <option value="fast">快</option><option value="balanced">标准</option><option value="deep">细</option>
          </select>
        </div>
        <div class="settings-row">
          <div>
            <b>本机语义检索</b>
            <small>{settings.semantic.detail}。装了 Ollama 的嵌入模型（比如 bge-m3），「她最近冷了」也能找回「没以前热情」这种说法不同的旧记录。</small>
          </div>
          <select value={settings.semantic.mode} onChange={async (e) => { await api.saveSettings({ semantic: (e.target as HTMLSelectElement).value as "auto" | "off" }); void refreshSettings(); }}>
            <option value="auto">自动</option><option value="off">关闭</option>
          </select>
        </div>
        <div class="settings-row">
          <div><b>你是</b><small>写了之后，军师会用对打法（追女生、追男生两套路数不一样）；不写就按聊天判断</small></div>
          <select value={settings.me} onChange={async (e) => { await api.saveSettings({ me: (e.target as HTMLSelectElement).value }); void refreshSettings(); }}>
            <option value="">不写</option><option value="f">女生</option><option value="m">男生</option>
          </select>
        </div>
        <div class="settings-row">
          <div><b>纸色</b><small>宣纸（亮）/ 墨夜（暗）/ 跟随系统</small></div>
          <select value={theme} onChange={(e) => applyTheme((e.target as HTMLSelectElement).value)}>
            <option value="auto">跟随系统</option><option value="light">宣纸</option><option value="dark">墨夜</option>
          </select>
        </div>
        <p class="note small">数据都在 <code>{settings.home}</code> · 电子军师 {settings.version}</p>
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
    if (!result) { toast("选一下 ta 后来的反应", "zhu"); return; }
    try {
      await api.recordOutcome(person!.id, { turnId, planIndex: plan?.index, seal: plan?.seal, suggested: plan?.lines.join("\n"), sent, reply, result, delayHours: delay, signals });
      await Promise.all([reloadTurns(person!.id), refreshDossier(person!.id)]);
      close();
      toast("记下了，军师下次会参考", "jade");
    } catch (err) { reportError(err); }
  }
  return (
    <Dialog title="后来怎样" kicker="记一笔" onClose={close} wide>
      <form class="dlg-body two" onSubmit={save}>
        <div>
          <label class="field"><span>你最后实际发的 {plan && <i>「{plan.seal}」那条，改过就改成真的</i>}</span>
            <textarea rows={3} value={sent} onInput={(e) => setSent((e.target as HTMLTextAreaElement).value)} />
          </label>
          <label class="field"><span>ta 回了什么 <i>文字或截图</i></span>
            <textarea rows={4} value={reply} placeholder="粘贴 ta 的回复" onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} />
          </label>
          <Drop files={files} onFiles={setFiles} hint="贴回复截图，让 AI 帮你选好下面的选项" />
          <button type="button" class="btn btn-line wide" disabled={guessing || (!reply.trim() && !files.length)} onClick={guess}>
            <Icon name="spark" size={15} />{guessing ? "在看…" : "让军师帮我选"}
          </button>
          {reason && <p class="note">{reason}</p>}
        </div>
        <div>
          <div class="field"><span>ta 的反应</span>
            <div class="outcomes">
              {(Object.keys(OUTCOMES) as Outcome[]).map((r) => (
                <button type="button" key={r} class={`outcome r-${r} ${result === r ? "cur" : ""}`} onClick={() => setResult(r)}>
                  <b>{OUTCOMES[r].label}</b><small>{OUTCOMES[r].hint}</small>
                </button>
              ))}
            </div>
          </div>
          <label class="field"><span>大概多久回的</span>
            <select value={delay} onChange={(e) => setDelay(Number((e.target as HTMLSelectElement).value))}>
              <option value={0.2}>几分钟</option><option value={1}>一小时内</option><option value={6}>当天</option>
              <option value={24}>第二天</option><option value={72}>几天后</option><option value={168}>一周左右</option>
            </select>
          </label>
          <div class="field"><span>有这些就勾上</span>
            <div class="signals">
              {(Object.keys(SIGNALS) as SignalKey[]).map((k) => (
                <label key={k} class={`chip ${signals[k] ? "cur" : ""}`}>
                  <input type="checkbox" checked={Boolean(signals[k])} onChange={(e) => setSignals({ ...signals, [k]: (e.target as HTMLInputElement).checked })} />{SIGNALS[k]}
                </label>
              ))}
            </div>
          </div>
        </div>
        <footer class="dlg-foot">
          {prev && <button type="button" class="link" onClick={async () => { await api.deleteOutcome(person.id, prev.id); await reloadTurns(person.id); await refreshDossier(person.id); close(); }}>删掉这条记录</button>}
          <span class="grow" />
          <button type="button" class="btn btn-line" onClick={close}>先不记</button>
          <button class="btn btn-zhu">记下</button>
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
