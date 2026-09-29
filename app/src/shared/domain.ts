/** 前后端共用的领域常量与类型。 */

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

export interface PersonDTO {
  id: string;
  name: string;
  gender: Gender;
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
  keychain: string;
  home: string;
  version: string;
}
