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

/** 英语圈（以美国为准）的日子，按第几个星期几算的另外处理。 */
const FIXED_EN: Array<[number, number, string, string]> = [
  [1, 1, "New Year's Day", "Recovery brunch is a low-pressure date"],
  [2, 13, "Galentine's Day", "Their friends' day — don't compete with it"],
  [2, 14, "Valentine's Day", "The big one: book 1-2 weeks out; early on, low-key and fun beats a pricey prix-fixe"],
  [8, 1, "National Girlfriend Day", "Only if you're official — a cute text is enough"],
  [10, 1, "Cuffing season", "October to February: people get more open to something steady — good time to make real plans"],
  [10, 3, "National Boyfriend Day", "Only if you're official — a cute text is enough"],
  [10, 31, "Halloween", "A party together is a great low-pressure date; couples costumes are a soft launch"],
  [12, 24, "Christmas Eve", "Travel home is common; gift expectations depend on the stage"],
  [12, 25, "Christmas", "Travel home is common; gift expectations depend on the stage"],
  [12, 31, "New Year's Eve", "Midnight kiss = a statement; book early, or go to a party together"],
];

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const day = 1 + ((7 + weekday - first.getDay()) % 7) + (n - 1) * 7;
  return new Date(year, month, day);
}

export function upcomingFestivals(now: Date, horizonDays = 21, lang: "zh" | "en" = "zh"): Festival[] {
  const out: Festival[] = [];
  if (lang === "en") {
    for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
      for (const [m, d, name, note] of FIXED_EN) out.push({ name, date: new Date(year, m - 1, d), days: 0, note });
      out.push({ name: "Mother's Day (US)", date: nthWeekday(year, 4, 0, 2), days: 0, note: "Helping them pick a gift for their mom earns points" });
      out.push({ name: "Father's Day (US)", date: nthWeekday(year, 5, 0, 3), days: 0, note: "Helping them pick a gift for their dad earns points" });
      out.push({ name: "Thanksgiving (US)", date: nthWeekday(year, 10, 4, 4), days: 0, note: "Family time; Friendsgiving is an easier invite; 'whose family' is a real talk once serious" });
    }
    return out
      .map((f) => ({ ...f, days: daysBetween(now, f.date) }))
      .filter((f) => f.days >= 0 && f.days <= horizonDays)
      .sort((a, b) => a.days - b.days);
  }
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
const MONTHS_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function nextAnnual(text: string, now: Date): Date | null {
  let month: number;
  let day: number;
  const m = text.match(/(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*[日号]?/);
  const en = text.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
    ?? text.toLowerCase().match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (m) {
    month = Number(m[1]);
    day = Number(m[2]);
  } else if (en) {
    const nameFirst = isNaN(Number(en[1]));
    month = MONTHS_EN.indexOf(nameFirst ? en[1] : en[2]) + 1;
    day = Number(nameFirst ? en[2] : en[1]);
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let d = new Date(now.getFullYear(), month - 1, day);
  if (daysBetween(now, d) < 0) d = new Date(now.getFullYear() + 1, month - 1, day);
  return d;
}

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEK_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function partOfDay(d: Date, lang: "zh" | "en" = "zh"): string {
  const h = d.getHours();
  if (lang === "en") return h < 5 ? "late night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "late night";
  if (h < 5) return "凌晨";
  if (h < 9) return "早上";
  if (h < 12) return "上午";
  if (h < 14) return "中午";
  if (h < 18) return "下午";
  if (h < 23) return "晚上";
  return "深夜";
}

export function describeNow(d: Date, lang: "zh" | "en" = "zh"): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (lang === "en") return `${WEEK_EN[d.getDay()]}, ${MONTH_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${partOfDay(d, "en")} ${hh}:${mm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]} ${partOfDay(d)} ${hh}:${mm}`;
}

export function describeGap(from: Date | null, now: Date, lang: "zh" | "en" = "zh"): string | null {
  if (!from) return null;
  const hours = (now.getTime() - from.getTime()) / 3_600_000;
  if (lang === "en") {
    if (hours < 1) return "just now";
    if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  if (hours < 1) return "刚刚还在聊";
  if (hours < 24) return `${Math.round(hours)} 小时前`;
  const days = Math.round(hours / 24);
  return days === 1 ? "昨天" : `${days} 天前`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
