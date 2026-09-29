export function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days === 0) return hm;
  if (days === 1) return `昨天 ${hm}`;
  if (days < 7) return `${days} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function ago(iso?: string): string {
  if (!iso) return "";
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 2) return "刚刚";
  if (min < 60) return `${Math.round(min)} 分钟前`;
  if (min < 60 * 24) return `${Math.round(min / 60)} 小时前`;
  const d = Math.round(min / 1440);
  return d < 30 ? `${d} 天前` : `${Math.round(d / 30)} 个月前`;
}

const NUM = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
export function hanNum(n: number): string {
  return NUM[n] ?? String(n);
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
export function circled(n: number): string {
  return CIRCLED[n - 1] ?? `(${n})`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
