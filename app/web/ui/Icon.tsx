/** 线描小图标，笔画粗细统一 1.7，颜色跟随文字。 */

const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  menu: "M4 7h16M4 12h16M4 17h10",
  x: "M6 6l12 12M18 6L6 18",
  gear: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.6a7.6 7.6 0 0 1-2 1.2l-.4 2H11l-.4-2a7.6 7.6 0 0 1-2-1.2l-1.9.6-1.8-3.1 1.6-1.2a7.5 7.5 0 0 1 0-3l-1.6-1.2 1.8-3.1 1.9.6a7.6 7.6 0 0 1 2-1.2l.4-2h3.6l.4 2a7.6 7.6 0 0 1 2 1.2l1.9-.6 1.8 3.1-1.6 1.2a7.5 7.5 0 0 1 0 3z",
  copy: "M9 9h10v11H9zM5 15V4h10",
  pen: "M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5a1 1 0 1 0 0-.01",
  send: "M4 12l16-7-6 16-3-7-7-2z",
  stop: "M7 7h10v10H7z",
  book: "M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4zM9 20a2 2 0 0 1 0-4h10",
  chevron: "M8 10l4 4 4-4",
  trash: "M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13",
  pin: "M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  spark: "M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  back: "M15 6l-6 6 6 6",
  more: "M6 12h.01M12 12h.01M18 12h.01",
};

export function Icon(props: { name: keyof typeof PATHS | string; size?: number; class?: string }) {
  const s = props.size ?? 18;
  return (
    <svg class={`icon ${props.class ?? ""}`} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[props.name] ?? ""} />
    </svg>
  );
}
