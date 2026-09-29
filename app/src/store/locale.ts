/**
 * 界面语言：设置里选了就用选的；「自动」时跟随系统——中文环境用中文，其他环境用英文。
 *
 * macOS 从 Finder 启动时没有 LANG，所以先读系统首选语言（AppleLanguages）；
 * Linux 按 LC_ALL > LC_MESSAGES > LANG > LANGUAGE；Windows 看 ICU 给的系统区域。
 */

import { readSettings } from "./settings";
import type { ChatLang, Lang, PersonDTO } from "../shared/domain";

/** 把 "zh_CN.UTF-8" / "zh-Hans-CN" / "en_US" 这类标签归成 zh 或 en；C / POSIX 这种不算数。 */
export function langFromTag(tag: string | undefined | null): Lang | null {
  if (!tag) return null;
  const t = tag.trim().replace(/^["'(\s]+|["',)\s]+$/g, "").toLowerCase();
  if (!t || t === "c" || t === "posix" || t.startsWith("c.") || t.startsWith("posix.")) return null;
  return t.startsWith("zh") ? "zh" : "en";
}

function appleLanguages(): string | null {
  try {
    const out = Bun.spawnSync(["defaults", "read", "-g", "AppleLanguages"], { stdout: "pipe", stderr: "ignore", timeout: 2000 }).stdout.toString();
    // (\n    "zh-Hans-CN",\n    "en-US"\n)
    const first = out.split("\n").map((l) => l.trim()).find((l) => /^"?[a-zA-Z]{2}/.test(l));
    return first ?? null;
  } catch {
    return null;
  }
}

export function detectSystemLang(env: Record<string, string | undefined> = process.env, platform: string = process.platform): Lang {
  const forced = langFromTag(env.DJ_LANG);
  if (forced) return forced;
  if (platform === "darwin") {
    const apple = langFromTag(appleLanguages());
    if (apple) return apple;
  }
  for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const hit = langFromTag(env[key]);
    if (hit) return hit;
  }
  const language = langFromTag(env.LANGUAGE?.split(":")[0]);
  if (language) return language;
  try {
    const intl = langFromTag(Intl.DateTimeFormat().resolvedOptions().locale);
    if (intl) return intl;
  } catch { /* 没有 ICU 就算了 */ }
  return "en";
}

let detected: Lang | null = null;

export function systemLang(): Lang {
  if (!detected) detected = detectSystemLang();
  return detected;
}

/** App 的界面语言（也是军师写解说用的语言）。 */
export function appLang(): Lang {
  const setting = readSettings().language;
  return setting === "zh" || setting === "en" ? setting : systemLang();
}

/** 这段关系用哪种语言聊：决定锦囊语言、梗词典、人话检查和问答策略那一套。 */
export function chatLang(person: Pick<PersonDTO, "lang"> | { lang?: ChatLang }): Lang {
  return person.lang === "zh" || person.lang === "en" ? person.lang : appLang();
}

export function resetLocaleForTests(): void {
  detected = null;
}
