import type { EvidenceRef, PipelineInput, StructuredObservation, BeliefDimension } from "./types";
import { usefulnessFor } from "./store";
import { cosineSimilarity, embedText } from "../embedding";
import { retrievalTokens } from "./tokenize";

const SIGNALS: Array<{
  dimension: BeliefDimension; positive: RegExp; negative: RegExp; confidence: number; rationale: string;
}> = [
  { dimension: "engagement", positive: /继续|聊|哈哈|分享|问你|主动|回得|一起|可以|好呀|行啊/i, negative: /敷衍|冷淡|不回|消失|随便|嗯嗯|哦$|算了/i, confidence: .64, rationale: "互动投入线索" },
  { dimension: "trust", positive: /告诉你|坦白|秘密|放心|相信|真实|心里话/i, negative: /怀疑|骗|不信|防着|隐瞒|套路/i, confidence: .7, rationale: "信任与自我暴露线索" },
  { dimension: "communication_willingness", positive: /聊聊|说说|解释|回复|有空说|电话|语音/i, negative: /不想说|别问|以后再说|没什么好说|闭嘴/i, confidence: .72, rationale: "沟通意愿线索" },
  { dimension: "emotional_pressure", positive: /压力|难受|累|生气|烦|崩溃|焦虑|委屈|不舒服|吵/i, negative: /轻松|开心|没事|放松|好起来/i, confidence: .7, rationale: "情绪压力线索" },
  { dimension: "boundary_sensitivity", positive: /别|不要|不方便|隐私|界限|需要空间|先这样|尊重/i, negative: /都可以|随你|没关系|不介意/i, confidence: .76, rationale: "边界敏感度线索" },
  { dimension: "commitment_reliability", positive: /答应|做到|准时|说到做到|兑现|确定|安排好了/i, negative: /放鸽子|爽约|忘了|改天吧|临时取消|没做到/i, confidence: .83, rationale: "承诺兑现线索" },
  { dimension: "momentum", positive: /下次|周末|见面|一起|继续|以后|期待|计划/i, negative: /到此为止|别联系|暂停|冷静|结束|算了/i, confidence: .72, rationale: "关系推进线索" },
  { dimension: "initiative", positive: /主动|找你|约你|先发|问你|邀请|给你/i, negative: /总是我|从不主动|不找|被动/i, confidence: .75, rationale: "主动性线索" },
  { dimension: "consistency", positive: /一直|每次|稳定|照旧|还是会|长期/i, negative: /忽冷忽热|反复|突然|前后不一|变化很大/i, confidence: .7, rationale: "行为一致性线索" },
];

function clamp(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function extractObservations(input: PipelineInput, sourceId: string, observedAt = new Date().toISOString()): StructuredObservation[] {
  const text = input.text.trim();
  if (!text) return [];
  const results: StructuredObservation[] = [];
  for (const signal of SIGNALS) {
    const positive = signal.positive.test(text);
    const negative = signal.negative.test(text);
    if (!positive && !negative) continue;
    const value = positive === negative ? 0 : positive ? .68 : -.68;
    results.push({
      id: crypto.randomUUID(), profileSlug: input.profileSlug, sourceId,
      dimension: signal.dimension, value,
      confidence: positive && negative ? .34 : signal.confidence,
      reliability: input.mode === "ask" ? .55 : .7,
      observedAt, rationale: positive && negative ? `${signal.rationale}存在冲突` : signal.rationale,
    });
  }
  // A message itself is weak evidence of available communication, never a personality verdict.
  if (!results.some((item) => item.dimension === "communication_willingness")) {
    results.push({
      id: crypto.randomUUID(), profileSlug: input.profileSlug, sourceId,
      dimension: "communication_willingness", value: .12, confidence: .24,
      reliability: .62, observedAt, rationale: "仅确认本轮存在沟通，属于弱证据",
    });
  }
  return validateObservations(results);
}

export function validateObservations(items: StructuredObservation[]): StructuredObservation[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || !item.profileSlug || !item.sourceId || !item.observedAt) return false;
    if (seen.has(`${item.sourceId}:${item.dimension}`)) return false;
    seen.add(`${item.sourceId}:${item.dimension}`);
    item.value = clamp(Number(item.value));
    item.confidence = clamp(Number(item.confidence), 0, 1);
    item.reliability = clamp(Number(item.reliability), 0, 1);
    return Number.isFinite(Date.parse(item.observedAt));
  });
}

/** BM25 terms come from the hybrid tokenizer: ICU dictionary words when the
 * engine provides a zh segmenter, plus Han bigrams for recall. */
function terms(text: string): string[] {
  return retrievalTokens(text);
}

function recency(observedAt: string): number {
  const ageDays = Math.max(0, (Date.now() - Date.parse(observedAt)) / 86_400_000);
  return Math.pow(.5, ageDays / 120);
}

/** Okapi BM25 over the candidate set, with document frequencies computed from
 * the same set — no global index needed at this scale. */
function bm25Scores(queryTerms: string[], documents: string[][]): number[] {
  const n = documents.length;
  if (!n || !queryTerms.length) return documents.map(() => 0);
  const df = new Map<string, number>();
  const unique = [...new Set(queryTerms)];
  for (const doc of documents) {
    const bag = new Set(doc);
    for (const term of unique) if (bag.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const averageLength = documents.reduce((sum, doc) => sum + doc.length, 0) / n || 1;
  const k1 = 1.4;
  const b = .6;
  return documents.map((doc) => {
    if (!doc.length) return 0;
    const tf = new Map<string, number>();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of unique) {
      const frequency = tf.get(term);
      if (!frequency) continue;
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + .5) / ((df.get(term) ?? 0) + .5));
      score += idf * frequency * (k1 + 1) / (frequency + k1 * (1 - b + b * doc.length / averageLength));
    }
    return score;
  });
}

/** Ranks → fused score via Reciprocal Rank Fusion: Σ w_r / (k + rank_r(d)). */
function rrfFuse(rankings: Array<{ scores: number[]; weight: number }>, count: number, k = 60): number[] {
  const fused = new Array(count).fill(0);
  for (const ranking of rankings) {
    const order = ranking.scores.map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score);
    order.forEach((entry, rank) => {
      if (entry.score > 0) fused[entry.index] += ranking.weight / (k + rank + 1);
    });
  }
  return fused;
}

/** Decision-oriented hybrid retrieval. BM25 and hashed-embedding cosine are
 * fused with reciprocal ranks alongside a decision prior (recency, reliability,
 * importance, learned usefulness); selection then applies MMR-style redundancy
 * suppression in embedding space, kind quotas, and contradiction coverage. */
export function retrieveEvidence(profileSlug: string, queryText: string, items: EvidenceRef[], limit: number): EvidenceRef[] {
  if (!items.length) return [];
  const queryTerms = terms(queryText);
  const queryVector = embedText(queryText);
  const vectors = items.map((item) => embedText(item.text));
  const lexical = bm25Scores(queryTerms, items.map((item) => terms(item.text)));
  const semantic = vectors.map((vector) => Math.max(0, cosineSimilarity(queryVector, vector)));
  const prior = items.map((item) => .35 * recency(item.observedAt) + .3 * item.reliability
    + .2 * item.importance + .15 * usefulnessFor(profileSlug, item.id));
  const fused = rrfFuse([
    { scores: lexical, weight: 1 },
    { scores: semantic, weight: 1 },
    { scores: prior, weight: .8 },
  ], items.length);
  const peak = Math.max(...fused, 1e-6);
  const ranked = items.map((item, index) => ({
    item: { ...item, relevance: Math.max(0, Math.min(1, fused[index] / peak)) },
    index,
    score: fused[index] + (item.contradiction ? .004 : 0),
  })).sort((a, b) => b.score - a.score);

  const selected: Array<{ item: EvidenceRef; index: number }> = [];
  const kindCount = new Map<string, number>();
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    const sameKind = kindCount.get(candidate.item.kind) ?? 0;
    if (sameKind >= Math.max(2, Math.ceil(limit * .55))) continue;
    const redundant = selected.some((other) =>
      cosineSimilarity(vectors[candidate.index], vectors[other.index]) > .82);
    if (redundant && !candidate.item.contradiction) continue;
    selected.push(candidate);
    kindCount.set(candidate.item.kind, sameKind + 1);
  }
  return selected.map((entry) => entry.item);
}
