import { useEffect, useReducer } from "preact/hooks";
import { api, ApiError, streamTurn, type TurnStreamEvent } from "./api";
import { setUiLang, T, uiLang } from "./i18n";
import type { DossierDTO, ImageRef, JobDTO, Mode, PersonDTO, SettingsDTO, TurnContext, TurnDTO } from "../../src/shared/domain";

export type Dialog =
  | { type: "new" }
  | { type: "settings" }
  | { type: "import" }
  | { type: "person" }
  | { type: "feedback"; turnId: string; planIndex?: number };

export interface Live {
  personId: string;
  turnId?: string;
  mode: Mode;
  output: string;
  status?: string;
  startedAt: number;
  firstTokenAt?: number;
  context?: TurnContext;
}

export interface Draft {
  mode: Mode;
  text: string;
  images: Array<ImageRef & { uploading?: boolean; localUrl?: string }>;
}

export interface AppState {
  booted: boolean;
  settings: SettingsDTO | null;
  people: PersonDTO[];
  currentId: string | null;
  turns: Record<string, TurnDTO[]>;
  dossiers: Record<string, DossierDTO>;
  live: Live | null;
  drafts: Record<string, Draft>;
  dialog: Dialog | null;
  toast: { text: string; tone: "ink" | "zhu" | "jade"; id: number } | null;
  drawer: "left" | "right" | null;
  dossierOpen: boolean;
}

const saved = (() => {
  try { return JSON.parse(localStorage.getItem("junshi.ui") ?? "{}"); } catch { return {}; }
})();

let state: AppState = {
  booted: false,
  settings: null,
  people: [],
  currentId: saved.currentId ?? null,
  turns: {},
  dossiers: {},
  live: null,
  drafts: {},
  dialog: null,
  toast: null,
  drawer: null,
  dossierOpen: saved.dossierOpen ?? true,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  try { localStorage.setItem("junshi.ui", JSON.stringify({ currentId: state.currentId, dossierOpen: state.dossierOpen })); } catch { /* 隐私模式 */ }
  for (const l of listeners) l();
}

export function useApp(): AppState {
  const [, force] = useReducer((x: number, _: void) => x + 1, 0);
  useEffect(() => {
    const l = () => force(undefined);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return state;
}

let toastSeq = 0;
export function toast(text: string, tone: "ink" | "zhu" | "jade" = "ink"): void {
  const id = ++toastSeq;
  setState({ toast: { text, tone, id } });
  setTimeout(() => { if (state.toast?.id === id) setState({ toast: null }); }, tone === "zhu" ? 5200 : 2600);
}

export function reportError(e: unknown): void {
  const err = e as ApiError;
  toast(err?.hint ? `${err.message}${uiLang() === "en" ? " — " : "——"}${err.hint}` : String(err?.message ?? e), "zhu");
}

// ---------------------------------------------------------------------------

export function current(): PersonDTO | null {
  return state.people.find((p) => p.id === state.currentId) ?? null;
}

export function draftOf(personId: string): Draft {
  return state.drafts[personId] ?? { mode: "reply", text: "", images: [] };
}

export function setDraft(personId: string, patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)): void {
  setState((s) => {
    const cur = s.drafts[personId] ?? { mode: "reply" as Mode, text: "", images: [] };
    const next = typeof patch === "function" ? patch(cur) : patch;
    return { drafts: { ...s.drafts, [personId]: { ...cur, ...next } } };
  });
}

export async function boot(): Promise<void> {
  try {
    const [settings, people] = await Promise.all([api.settings(), api.people()]);
    setUiLang(settings.lang);
    // #p=<档案编号> 直达某个人
    const wanted = new URLSearchParams(location.hash.slice(1)).get("p");
    const currentId = wanted && people.some((p) => p.id === wanted) ? wanted
      : people.some((p) => p.id === state.currentId) ? state.currentId : people[0]?.id ?? null;
    setState({ settings, people, currentId, booted: true });
    if (currentId) await openPerson(currentId);
  } catch (e) {
    setState({ booted: true });
    reportError(e);
  }
}

export async function refreshSettings(): Promise<void> {
  const settings = await api.settings();
  setUiLang(settings.lang);
  setState({ settings });
}

export async function refreshPeople(): Promise<void> {
  setState({ people: await api.people() });
}

export async function refreshDossier(personId: string): Promise<void> {
  try {
    const d = await api.dossier(personId);
    setState((s) => ({ dossiers: { ...s.dossiers, [personId]: d } }));
    if (d.job && (d.job.status === "running" || d.job.status === "queued")) watchJob(personId, d.job.id);
  } catch { /* 删掉了 */ }
}

export async function openPerson(personId: string): Promise<void> {
  setState({ currentId: personId, drawer: null });
  const [turns] = await Promise.all([api.turns(personId), refreshDossier(personId)]);
  setState((s) => ({ turns: { ...s.turns, [personId]: turns } }));
}

const watching = new Set<string>();
export function watchJob(personId: string, jobId: string): void {
  if (watching.has(jobId)) return;
  watching.add(jobId);
  const tick = async () => {
    try {
      const job: JobDTO = await api.job(jobId);
      setState((s) => {
        const d = s.dossiers[personId];
        return d ? { dossiers: { ...s.dossiers, [personId]: { ...d, job } } } : {};
      });
      if (job.status === "running" || job.status === "queued") { setTimeout(tick, 1500); return; }
      watching.delete(jobId);
      await refreshDossier(personId);
      if (job.status === "done") toast(job.message ?? T().created, "jade");
    } catch {
      watching.delete(jobId);
    }
  };
  void tick();
}

// ---------------------------------------------------------------------------
// 发一轮

let abort: AbortController | null = null;
let frame = 0;
let pendingOutput = "";

function flushLive(): void {
  frame = 0;
  setState((s) => (s.live ? { live: { ...s.live, output: pendingOutput } } : {}));
}

export async function send(personId: string): Promise<void> {
  const draft = draftOf(personId);
  if (state.live) return;
  if (draft.images.some((i) => i.uploading)) { toast(T().uploadingWait); return; }
  const text = draft.text.trim();
  if (!text && !draft.images.length) { toast(T().pasteFirst); return; }
  abort = new AbortController();
  pendingOutput = "";
  setState({ live: { personId, mode: draft.mode, output: "", startedAt: Date.now() } });
  const images = draft.images.map(({ id, name, url }) => ({ id, name, url }));
  setDraft(personId, { text: "", images: [] });
  let placed = false;
  const onEvent = (e: TurnStreamEvent) => {
    if (e.type === "turn") {
      placed = true;
      setState((s) => ({
        live: s.live ? { ...s.live, turnId: e.turn.id } : s.live,
        turns: { ...s.turns, [personId]: [...(s.turns[personId] ?? []), e.turn] },
      }));
    } else if (e.type === "context") {
      setState((s) => (s.live ? { live: { ...s.live, context: e.context } } : {}));
    } else if (e.type === "delta") {
      pendingOutput += e.text;
      if (!state.live?.firstTokenAt) setState((s) => (s.live ? { live: { ...s.live, firstTokenAt: Date.now() } } : {}));
      if (!frame) frame = requestAnimationFrame(flushLive);
    } else if (e.type === "status") {
      setState((s) => (s.live ? { live: { ...s.live, status: e.text } } : {}));
    } else if (e.type === "replace") {
      pendingOutput = e.output;
      flushLive();
    } else if (e.type === "done" || e.type === "error") {
      const turn = e.turn;
      if (turn) setState((s) => ({ turns: { ...s.turns, [personId]: (s.turns[personId] ?? []).map((t) => (t.id === turn.id ? turn : t)) } }));
      if (e.type === "error") reportError(new ApiError(e.message, e.hint));
    }
  };
  try {
    await streamTurn(personId, { mode: draft.mode, text: draft.text, imageIds: images.map((i) => i.id) }, onEvent, abort.signal);
  } catch (e: any) {
    if (e?.name !== "AbortError") {
      reportError(e);
      if (!placed) setDraft(personId, { text: draft.text, images: draft.images });
    }
  } finally {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    abort = null;
    setState({ live: null });
    const turns = await api.turns(personId).catch(() => null);
    if (turns) setState((s) => ({ turns: { ...s.turns, [personId]: turns } }));
    void refreshDossier(personId);
    void refreshPeople();
  }
}

export function stop(): void {
  abort?.abort();
}

export function patchTurn(personId: string, turnId: string, patch: Partial<TurnDTO>): void {
  setState((s) => ({ turns: { ...s.turns, [personId]: (s.turns[personId] ?? []).map((t) => (t.id === turnId ? { ...t, ...patch } : t)) } }));
}

export async function reloadTurns(personId: string): Promise<void> {
  const turns = await api.turns(personId);
  setState((s) => ({ turns: { ...s.turns, [personId]: turns } }));
}
