/** 前后端共用的领域常量与类型。中文是原生版本，英文版在文件后半部分的 EN 表里。 */

export type Lang = "zh" | "en";

export type Mode = "reply" | "read" | "polish" | "odds";

export const MODES: Record<Mode, { label: string; hint: string; placeholder: string; doctrine: string }> = {
  reply: { label: "怎么回", hint: "三个锦囊，挑一句发", placeholder: "把 ta 发来的话贴进来，或者直接丢截图", doctrine: "怎么回" },
  read: { label: "读懂 ta", hint: "只拆解，不替我回", placeholder: "贴 ta 的话，我帮你拆开看", doctrine: "读懂 ta" },
  polish: { label: "帮我改", hint: "我想发的，行不行", placeholder: "写下你想发的话（可以先贴 ta 的上一句，换行再写你的）", doctrine: "帮我改" },
  odds: { label: "有没有戏", hint: "看行动，不看甜话", placeholder: "说说最近的情况，或者丢几张聊天截图", doctrine: "有没有戏" },
};

export const STAGES = [
  { n: 0, name: "初识期", short: "刚认识", cap: 0 },
  { n: 1, name: "暧昧期", short: "暧昧", cap: 1.5 },
  { n: 2, name: "追求期", short: "在追", cap: 2 },
  { n: 3, name: "告白确认", short: "快挑明了", cap: 2.5 },
  { n: 4, name: "热恋初期", short: "刚在一起", cap: 3.5 },
  { n: 5, name: "稳定期", short: "在一起挺久", cap: 3 },
  { n: 6, name: "磨合期", short: "闹别扭", cap: 1.5 },
  { n: 7, name: "危机期", short: "快崩了", cap: 0.5 },
] as const;

export function stageOf(n: number) {
  return STAGES[Math.max(0, Math.min(7, Math.round(n)))] ?? STAGES[1];
}

/** 胆量五档。delta 调整油腻上限，brief 写进提示词。 */
export const NERVES = [
  { n: 0, name: "很稳", delta: -1, brief: "三个锦囊都要能进能退；「奇」偏展示自己或真诚；拿不准时推荐「稳」" },
  { n: 1, name: "偏稳", delta: -0.5, brief: "动作小一点、留余地；「奇」偏展示自己；拿不准时推荐「稳」" },
  { n: 2, name: "平衡", delta: 0, brief: "按局面来" },
  { n: 3, name: "偏敢", delta: 0.5, brief: "「撩」可以更明显；「奇」给一个推进型动作（约、挑明一点、制造见面理由）；局面允许时推荐「撩」" },
  { n: 4, name: "放胆冲", delta: 1, brief: "「奇」给最大胆但站得住的一步：直接约、直接问、打直球；局面允许时推荐「奇」" },
] as const;

export function nerveOf(n: number) {
  return NERVES[Math.max(0, Math.min(4, Math.round(n)))] ?? NERVES[2];
}

export function oilCap(stage: number, nerve: number): number {
  return Math.max(0, Math.min(5, stageOf(stage).cap + nerveOf(nerve).delta));
}

export type Outcome = "good" | "meh" | "cold" | "ghosted";

export const OUTCOMES: Record<Outcome, { label: string; hint: string }> = {
  good: { label: "接住了", hint: "ta 接得很顺，还往下聊" },
  meh: { label: "一般", hint: "回了，但没什么变化" },
  cold: { label: "聊冷了", hint: "变冷、尴尬或者被挡回来" },
  ghosted: { label: "没回", hint: "一直没等到回复" },
};

export const SIGNALS = {
  continued: "愿意继续聊",
  initiated: "ta 主动推进",
  askedBack: "反问了我",
  followedThrough: "说到做到",
  brokePromise: "答应了没做到",
  rememberedDetail: "记得以前的细节",
} as const;
export type SignalKey = keyof typeof SIGNALS;

export const FACT_SLOTS = {
  basic: "基本",
  like: "喜欢",
  dislike: "不喜欢",
  diet: "忌口",
  habit: "作息",
  phrase: "口头禅",
  wish: "想做没做",
  plan: "安排",
  promise: "约定",
  subtext: "潜台词",
} as const;
export type FactSlot = keyof typeof FACT_SLOTS;

export type Gender = "" | "m" | "f";

export const GENDERS: Record<Gender, { label: string; pronoun: string }> = {
  "": { label: "不写", pronoun: "ta" },
  m: { label: "男生", pronoun: "他" },
  f: { label: "女生", pronoun: "她" },
};

export function pronounOf(g: string | undefined): string {
  return GENDERS[(g ?? "") as Gender]?.pronoun ?? "ta";
}

// ---------------------------------------------------------------------------
// English labels. The strategy tables (caps, deltas) are shared; only words differ.

export const MODES_EN: Record<Mode, { label: string; hint: string; placeholder: string; doctrine: string }> = {
  reply: { label: "Reply", hint: "three moves", placeholder: "Paste what they sent, or drop a screenshot", doctrine: "Reply" },
  read: { label: "Decode", hint: "what they mean", placeholder: "Paste their message and I'll take it apart", doctrine: "Decode" },
  polish: { label: "Check my text", hint: "send or not?", placeholder: "Write what you want to send (you can paste their last message first, then yours on a new line)", doctrine: "Check my text" },
  odds: { label: "Any chance?", hint: "actions, not words", placeholder: "Tell me what's been happening, or drop a few chat screenshots", doctrine: "Any chance?" },
};

export const STAGES_EN = [
  { name: "Just met", short: "just met" },
  { name: "Talking stage", short: "talking" },
  { name: "Dating", short: "dating" },
  { name: "About to DTR", short: "almost official" },
  { name: "Honeymoon", short: "new couple" },
  { name: "Steady", short: "together a while" },
  { name: "Rough patch", short: "rough patch" },
  { name: "On the rocks", short: "on the rocks" },
] as const;

export const NERVES_EN = [
  { name: "Play it safe", brief: "every move must be easy to walk back; Wildcard leans on showing yourself or sincerity; when unsure, pick Steady" },
  { name: "Careful", brief: "small moves, leave room; Wildcard leans on showing yourself; when unsure, pick Steady" },
  { name: "Balanced", brief: "read the room" },
  { name: "Bold", brief: "Flirt can be more obvious; Wildcard is a forward move (ask them out, name the vibe, create a reason to meet); pick Flirt when the room allows" },
  { name: "All in", brief: "Wildcard is the boldest move that still stands up: ask them out, ask straight, shoot your shot; pick Wildcard when the room allows" },
] as const;

export const OUTCOMES_EN: Record<Outcome, { label: string; hint: string }> = {
  good: { label: "Landed", hint: "they ran with it" },
  meh: { label: "Meh", hint: "replied, nothing changed" },
  cold: { label: "Went cold", hint: "cooler, awkward, or brushed off" },
  ghosted: { label: "No reply", hint: "nothing back" },
};

export const SIGNALS_EN: Record<SignalKey, string> = {
  continued: "kept the chat going",
  initiated: "they moved things forward",
  askedBack: "asked me back",
  followedThrough: "followed through",
  brokePromise: "flaked on a plan",
  rememberedDetail: "remembered a detail",
};

export const FACT_SLOTS_EN: Record<FactSlot, string> = {
  basic: "Basics",
  like: "Likes",
  dislike: "Dislikes",
  diet: "Food",
  habit: "Routine",
  phrase: "Sayings",
  wish: "Wishlist",
  plan: "Plans",
  promise: "Promises",
  subtext: "Subtext",
};

export const GENDERS_EN: Record<Gender, { label: string; pronoun: string }> = {
  "": { label: "Not set", pronoun: "they" },
  m: { label: "Man", pronoun: "he" },
  f: { label: "Woman", pronoun: "she" },
};

/** 按语言取标签；策略数值（上限、增减）两种语言共用。 */
export function labels(lang: Lang) {
  const en = lang === "en";
  return {
    modes: en ? MODES_EN : MODES,
    outcomes: en ? OUTCOMES_EN : OUTCOMES,
    signals: (en ? SIGNALS_EN : SIGNALS) as Record<SignalKey, string>,
    slots: (en ? FACT_SLOTS_EN : FACT_SLOTS) as Record<FactSlot, string>,
    genders: en ? GENDERS_EN : GENDERS,
    stage: (n: number) => {
      const i = Math.max(0, Math.min(7, Math.round(n)));
      return en ? { ...STAGES_EN[i], n: i, cap: STAGES[i].cap } : { name: STAGES[i].name, short: STAGES[i].short, n: i, cap: STAGES[i].cap };
    },
    nerve: (n: number) => {
      const i = Math.max(0, Math.min(4, Math.round(n)));
      return en ? { ...NERVES_EN[i], n: i, delta: NERVES[i].delta } : { name: NERVES[i].name, brief: NERVES[i].brief, n: i, delta: NERVES[i].delta };
    },
    pronoun: (g: string | undefined) => (en ? GENDERS_EN : GENDERS)[(g ?? "") as Gender]?.pronoun ?? (en ? "they" : "ta"),
  };
}

/** 锦囊印的英文名。内部统计一律用 稳 / 撩 / 奇 三个字。 */
export const SEAL_EN: Record<string, string> = { 稳: "Steady", 撩: "Flirt", 奇: "Wildcard" };

/** 读局车道：按这一轮的内容选打法侧重。 */
export type Lane = "daily" | "emotion" | "conflict" | "invite" | "meme" | "pushpull";

export const LANE_LABELS: Record<Lang, Record<Lane, string>> = {
  zh: { daily: "日常", emotion: "情绪", conflict: "冲突", invite: "邀约", meme: "玩梗", pushpull: "拉扯" },
  en: { daily: "everyday", emotion: "feelings", conflict: "conflict", invite: "making plans", meme: "banter", pushpull: "mixed signals" },
};

/** 老数据里存的是中文车道名，照原样显示；新数据用 id 翻译。 */
export function laneLabel(lane: string, lang: Lang): string {
  return (LANE_LABELS[lang] as Record<string, string>)[lane] ?? lane;
}

/** 人的聊天语言：'' 跟随 App，'zh' 中文，'en' 英文。 */
export type ChatLang = "" | Lang;

export interface PersonDTO {
  id: string;
  name: string;
  gender: Gender;
  /** 这段关系用哪种语言聊（决定锦囊语言、梗词典、人话检查）；'' 跟随 App 语言 */
  lang: ChatLang;
  stage: number;
  nerve: number;
  clearEyed: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
  lastTurnAt?: string;
  lastLine?: string;
  turns: number;
}

export interface ImageRef {
  id: string;
  name: string;
  url: string;
}

export interface LintFinding {
  level: "FAIL" | "WARN";
  check: string;
  bubble: number | null;
  text: string;
  hint: string;
}

export interface LintResult {
  result: "PASS" | "FAIL";
  failCount: number;
  warnCount: number;
  findings: LintFinding[];
}

export interface PlanCheck {
  index: number;
  seal: string;
  text: string;
  lint: LintResult;
  revised?: boolean; // 服务端自动修过
  stuck?: string; // 修过还没过，卡在哪
}

export interface MemeHit {
  term: string;
  matched: string;
  meaning: string;
  tone: string;
  status: string;
}

export interface TurnDTO {
  id: string;
  personId: string;
  mode: Mode;
  input: string;
  images: ImageRef[];
  output: string;
  checks: PlanCheck[];
  memes: MemeHit[];
  status: "streaming" | "done" | "error";
  error?: string;
  provider?: string;
  model?: string;
  createdAt: string;
  context?: TurnContext;
  outcome?: OutcomeDTO;
  copied?: number[]; // 被复制过的锦囊序号
}

export interface TurnContext {
  lane: string;
  /** 这一轮用的是哪套问答策略 */
  lang?: Lang;
  modules: string[];
  facts: number;
  recalled: Array<{ id: string; kind: string; text: string; when?: string; why: string }>;
  tactics: number;
  festivals: string[];
}

export interface OutcomeDTO {
  id: string;
  turnId?: string;
  planIndex?: number;
  seal?: string;
  suggested?: string;
  sent: string;
  reply: string;
  result: Outcome;
  delayHours?: number;
  signals: Partial<Record<SignalKey, boolean>>;
  createdAt: string;
}

export interface FactDTO {
  id: string;
  slot: FactSlot;
  text: string;
  date?: string;
  source: string;
  sourceLabel: string;
  confidence: number;
  status: "active" | "expired" | "superseded" | "removed";
  pinned: boolean;
  seen: number;
  updatedAt: string;
}

export interface MemeMemoryDTO {
  term: string;
  meaning: string;
  count: number;
  lastSeen: string;
  avoid: boolean;
}

export interface ReadingPoint {
  turnId: string;
  at: string;
  sweet?: number;
  initiative?: number;
  commitment?: number;
  action?: number;
  overall?: number;
  player?: number;
}

export interface TacticStat {
  seal: string;
  tries: number;
  good: number;
  meh: number;
  cold: number;
  ghosted: number;
}

export interface DossierDTO {
  person: PersonDTO;
  facts: FactDTO[];
  memes: MemeMemoryDTO[];
  readings: ReadingPoint[];
  tactics: TacticStat[];
  worked: Array<{ text: string; seal?: string; count: number; lastAt: string }>;
  flopped: Array<{ text: string; seal?: string; result: Outcome; at: string }>;
  style: StyleProfile;
  archive: { total: number; screenshots: number; pastes: number };
  job?: JobDTO;
}

export interface StyleProfile {
  samples: number;
  avgLen?: number;
  bubbles?: number;
  punctuation?: "none" | "light" | "full";
  habits: string[];
}

export interface JobDTO {
  id: string;
  status: "queued" | "running" | "waiting" | "done" | "partial";
  total: number;
  done: number;
  failed: number;
  current?: string;
  message?: string;
  items: Array<{ id: string; name: string; kind: "image" | "text"; status: "queued" | "running" | "done" | "failed"; summary?: string; error?: string }>;
}

export type ProviderKind = "codex" | "claude-code" | "claude" | "deepseek" | "glm" | "custom" | "demo";

export interface ProviderStatusDTO {
  kind: ProviderKind;
  label: string;
  ready: boolean;
  detail: string;
  vision: boolean;
  needsKey: boolean;
  hasKey: boolean;
  model?: string;
  models: string[];
  baseUrl?: string;
  local: boolean;
}

export interface SettingsDTO {
  provider: ProviderKind;
  providers: ProviderStatusDTO[];
  semantic: { mode: "auto" | "off"; available: boolean; model?: string; detail: string };
  depth: "fast" | "balanced" | "deep";
  me: Gender;
  /** 界面语言设置；lang 是解析后的实际语言（auto 时跟随系统） */
  language: "auto" | Lang;
  lang: Lang;
  keychain: string;
  home: string;
  version: string;
}
