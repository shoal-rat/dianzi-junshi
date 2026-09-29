import type {
  DossierDTO, FactDTO, ImageRef, JobDTO, LintResult, MemeMemoryDTO, Mode, OutcomeDTO, PersonDTO, ProviderKind,
  SettingsDTO, SignalKey, TurnContext, TurnDTO, Outcome,
} from "../../src/shared/domain";

export class ApiError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as any).error ?? `请求失败（${res.status}）`, (data as any).hint);
  return data as T;
}

export const api = {
  settings: () => call<SettingsDTO>("GET", "/api/settings"),
  saveSettings: (patch: { provider?: ProviderKind; semantic?: "auto" | "off"; depth?: "fast" | "balanced" | "deep"; me?: string; providers?: Record<string, { model?: string; baseUrl?: string }>; key?: { kind: ProviderKind; value: string | null } }) =>
    call<SettingsDTO>("POST", "/api/settings", patch),
  people: () => call<PersonDTO[]>("GET", "/api/people"),
  createPerson: (p: { name: string; gender: string; stage: number; nerve: number; clearEyed: boolean; note?: string; history?: string }) =>
    call<{ person: PersonDTO; job: JobDTO | null }>("POST", "/api/people", p),
  updatePerson: (id: string, patch: Partial<{ name: string; gender: string; stage: number; nerve: number; clearEyed: boolean; note: string }>) =>
    call<PersonDTO>("PATCH", `/api/people/${id}`, patch),
  deletePerson: (id: string) => call<{ ok: true }>("DELETE", `/api/people/${id}`),
  turns: (id: string, before?: string) => call<TurnDTO[]>("GET", `/api/people/${id}/turns${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  dossier: (id: string) => call<DossierDTO>("GET", `/api/people/${id}/dossier`),
  deleteTurn: (id: string) => call<{ ok: true }>("DELETE", `/api/turns/${id}`),
  copied: (turnId: string, planIndex: number) => call<{ ok: true }>("POST", `/api/turns/${turnId}/copy`, { planIndex }),
  revise: (turnId: string, planIndex: number, ask?: string) => call<TurnDTO>("POST", `/api/turns/${turnId}/revise`, { planIndex, ask }),
  importStuff: (id: string, p: { imageIds?: string[]; text?: string }) => call<JobDTO>("POST", `/api/people/${id}/import`, p),
  job: (id: string) => call<JobDTO>("GET", `/api/jobs/${id}`),
  retryJob: (id: string) => call<JobDTO>("POST", `/api/jobs/${id}/retry`),
  recordOutcome: (id: string, p: { turnId?: string; planIndex?: number; seal?: string; suggested?: string; sent: string; reply?: string; result: Outcome; delayHours?: number; signals?: Partial<Record<SignalKey, boolean>> }) =>
    call<OutcomeDTO>("POST", `/api/people/${id}/outcomes`, p),
  guessOutcome: (id: string, p: { sent: string; reply?: string; imageIds?: string[] }) =>
    call<{ result: Outcome; reply: string; delayHours: number; signals: Partial<Record<SignalKey, boolean>>; reason: string }>("POST", `/api/people/${id}/outcomes/guess`, p),
  deleteOutcome: (id: string, oid: string) => call<{ ok: true }>("DELETE", `/api/people/${id}/outcomes/${oid}`),
  addFact: (id: string, slot: string, text: string) => call<FactDTO[]>("POST", `/api/people/${id}/facts`, { slot, text }),
  updateFact: (id: string, fid: string, patch: { text?: string; slot?: string; pinned?: boolean; status?: "active" | "removed" }) =>
    call<FactDTO[]>("PATCH", `/api/people/${id}/facts/${fid}`, patch),
  meme: (id: string, term: string, patch: { avoid?: boolean; remove?: boolean }) => call<MemeMemoryDTO[]>("POST", `/api/people/${id}/memes`, { term, ...patch }),
};

export async function uploadImage(personId: string, file: Blob & { name?: string }, origin: "turn" | "import" | "feedback"): Promise<ImageRef & { duplicate: boolean }> {
  const res = await fetch(`/api/people/${personId}/images?origin=${origin}`, {
    method: "POST",
    headers: { "x-file-name": encodeURIComponent(file.name || "截图.png"), "content-type": "application/octet-stream" },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as any).error ?? "上传失败");
  return data as ImageRef & { duplicate: boolean };
}

export type TurnStreamEvent =
  | { type: "turn"; turn: TurnDTO }
  | { type: "context"; context: TurnContext }
  | { type: "delta"; text: string }
  | { type: "status"; text: string }
  | { type: "replace"; output: string }
  | { type: "done"; turn: TurnDTO }
  | { type: "error"; message: string; hint?: string; turn?: TurnDTO };

/** POST 一轮并读 SSE。 */
export async function streamTurn(personId: string, body: { mode: Mode; text: string; imageIds: string[] }, onEvent: (e: TurnStreamEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`/api/people/${personId}/turns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError((data as any).error ?? "发送失败", (data as any).hint);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      try { onEvent(JSON.parse(data)); } catch { /* 忽略坏包 */ }
    }
  }
}
