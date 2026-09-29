import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon";
import { uploadImage } from "../lib/api";
import { draftOf, getState, reportError, send, setDraft, stop, useApp } from "../lib/store";
import { T, uiLang } from "../lib/i18n";
import { labels, type Mode, type PersonDTO } from "../../src/shared/domain";

export async function addFiles(personId: string, files: File[], origin: "turn" | "import" = "turn"): Promise<void> {
  const images = files.filter((f) => /^image\/(png|jpe?g|webp|gif)$/.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
  if (!images.length) return;
  const temp = images.map((f) => ({ id: `tmp-${crypto.randomUUID()}`, name: f.name || T().screenshot, url: URL.createObjectURL(f), uploading: true, localUrl: URL.createObjectURL(f) }));
  setDraft(personId, (d) => ({ images: [...d.images, ...temp].slice(0, 12) }));
  await Promise.all(images.map(async (file, i) => {
    try {
      const ref = await uploadImage(personId, file, origin);
      setDraft(personId, (d) => ({ images: d.images.some((x) => x.id === ref.id) ? d.images.filter((x) => x.id !== temp[i].id) : d.images.map((x) => (x.id === temp[i].id ? { ...ref, localUrl: temp[i].localUrl } : x)) }));
    } catch (e) {
      reportError(e);
      setDraft(personId, (d) => ({ images: d.images.filter((x) => x.id !== temp[i].id) }));
    }
  }));
}

export function Composer({ person }: { person: PersonDTO }) {
  const s = useApp();
  const draft = draftOf(person.id);
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const busy = Boolean(s.live);
  const mine = s.live?.personId === person.id;
  const t = T();
  const MODES = labels(uiLang()).modes;

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(260, el.scrollHeight)}px`;
  }, [draft.text, person.id]);

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (!getState().live) void send(person.id);
    }
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) { e.preventDefault(); void addFiles(person.id, files); }
  }

  return (
    <footer class={`composer ${drag ? "drag" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(person.id, [...(e.dataTransfer?.files ?? [])]); }}>
      <div class="modes" role="tablist" aria-label={t.modesAria}>
        {(Object.keys(MODES) as Mode[]).map((m) => (
          <button key={m} role="tab" aria-selected={draft.mode === m} class={`mode ${draft.mode === m ? "cur" : ""}`}
            onClick={() => setDraft(person.id, { mode: m })}>
            <b>{MODES[m].label}</b><small>{MODES[m].hint}</small>
          </button>
        ))}
      </div>
      <div class="paper">
        {draft.images.length > 0 && (
          <div class="attach-strip">
            {draft.images.map((img) => (
              <div key={img.id} class={`attach ${img.uploading ? "uploading" : ""}`}>
                <img src={img.localUrl ?? img.url} alt={img.name} />
                <button aria-label={t.remove} onClick={() => setDraft(person.id, (d) => ({ images: d.images.filter((x) => x.id !== img.id) }))}><Icon name="x" size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <textarea ref={ta} rows={2} value={draft.text} placeholder={MODES[draft.mode].placeholder}
          onInput={(e) => setDraft(person.id, { text: (e.target as HTMLTextAreaElement).value })}
          onKeyDown={onKey} onPaste={onPaste} aria-label={t.contentAria} />
        <div class="paper-foot">
          <button class="btn btn-quiet" onClick={() => file.current?.click()}><Icon name="image" size={16} />{t.screenshot}</button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
            onChange={(e) => { const f = [...((e.target as HTMLInputElement).files ?? [])]; (e.target as HTMLInputElement).value = ""; void addFiles(person.id, f); }} />
          <span class="paper-tip">{t.composerTip}</span>
          {mine ? (
            <button class="btn btn-ink send" onClick={stop}><Icon name="stop" size={15} />{t.stop}</button>
          ) : (
            <button class="btn btn-zhu send" disabled={busy} onClick={() => send(person.id)}>{t.sendWord[draft.mode]}</button>
          )}
        </div>
      </div>
    </footer>
  );
}
