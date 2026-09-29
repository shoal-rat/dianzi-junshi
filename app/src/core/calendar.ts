/**
 * 此刻：真实日期、时段、临近节日与 ta 的重要日子。
 * 原 Skill 第 0 步「先跑 date」——App 里由服务端直接算好给军师。
 */

export interface Festival {
  name: string;
  date: Date;
  days: number;
  note: string;
}

const FIXED: Array<[number, number, string, string]> = [
  [1, 1, "元旦", "一起跨年是升级节点，人多，订位和交通早安排"],
  [2, 14, "情人节", "最正式的一天，餐厅花店提前一两周订"],
  [3, 8, "女生节", "轻表达日，小心意加一句会撩的话，别太用力"],
  [3, 14, "白色情人节", "情人节收了礼这天回礼"],
  [4, 1, "愚人节", "借玩笑试探要留退路"],
  [5, 20, "520", "网络情人节，热门店早订"],
  [6, 1, "儿童节", "装嫩玩梗的轻松日"],
  [10, 1, "国庆", "长假出游早订票订房，也可能各自回家"],
  [11, 11, "双十一", "可以借脱单梗推进，帮看购物车也算心意"],
  [12, 24, "平安夜", "年底约会季，人多早订"],
  [12, 25, "圣诞", "年底约会季，人多早订"],
];

/** 农历节日的阳历日期（月, 日）。只需要覆盖 App 活着的这几年。 */
const LUNAR: Record<number, Record<string, [number, number]>> = {
  2025: { 春节: [1, 29], 元宵: [2, 12], 七夕: [8, 29], 中秋: [10, 6] },
  2026: { 春节: [2, 17], 元宵: [3, 3], 七夕: [8, 19], 中秋: [9, 25] },
  2027: { 春节: [2, 6], 元宵: [2, 20], 七夕: [8, 8], 中秋: [9, 15] },
  2028: { 春节: [1, 26], 元宵: [2, 9], 七夕: [8, 26], 中秋: [10, 3] },
  2029: { 春节: [2, 13], 元宵: [2, 27], 七夕: [8, 16], 中秋: [9, 22] },
  2030: { 春节: [2, 3], 元宵: [2, 17], 七夕: [8, 5], 中秋: [9, 12] },
};

const LUNAR_NOTE: Record<string, string> = {
  春节: "各自回家的概率大，异地的话节前节后找机会",
  元宵: "适合轻松约一次，看灯吃元宵",
  七夕: "和情人节一个量级，热门位早订，仪式感按阶段来",
  中秋: "团圆节容易牵扯见家长；异地提前安排或寄点心",
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

function mothersDay(year: number): Date {
  const may1 = new Date(year, 4, 1);
  const firstSunday = 1 + ((7 - may1.getDay()) % 7);
  return new Date(year, 4, firstSunday + 7);
}

export function upcomingFestivals(now: Date, horizonDays = 21): Festival[] {
  const out: Festival[] = [];
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    for (const [m, d, name, note] of FIXED) out.push({ name, date: new Date(year, m - 1, d), days: 0, note });
    out.push({ name: "母亲节", date: mothersDay(year), days: 0, note: "帮对方想给妈妈的礼物，加分" });
    for (const [name, [m, d]] of Object.entries(LUNAR[year] ?? {})) {
      out.push({ name, date: new Date(year, m - 1, d), days: 0, note: LUNAR_NOTE[name] ?? "" });
    }
  }
  return out
    .map((f) => ({ ...f, days: daysBetween(now, f.date) }))
    .filter((f) => f.days >= 0 && f.days <= horizonDays)
    .sort((a, b) => a.days - b.days);
}

/** 从「生日：10月12日」「10/12」这类文字里读出下一次的日期。 */
export function nextAnnual(text: string, now: Date): Date | null {
  const m = text.match(/(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*[日号]?/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let d = new Date(now.getFullYear(), month - 1, day);
  if (daysBetween(now, d) < 0) d = new Date(now.getFullYear() + 1, month - 1, day);
  return d;
}

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function partOfDay(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "凌晨";
  if (h < 9) return "早上";
  if (h < 12) return "上午";
  if (h < 14) return "中午";
  if (h < 18) return "下午";
  if (h < 23) return "晚上";
  return "深夜";
}

export function describeNow(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${partOfDay(d)} ${hh}:${mm}`;
}

export function describeGap(from: Date | null, now: Date): string | null {
  if (!from) return null;
  const hours = (now.getTime() - from.getTime()) / 3_600_000;
  if (hours < 1) return "刚刚还在聊";
  if (hours < 24) return `${Math.round(hours)} 小时前`;
  const days = Math.round(hours / 24);
  return days === 1 ? "昨天" : `${days} 天前`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
