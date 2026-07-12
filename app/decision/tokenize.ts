/**
 * Chinese-aware hybrid tokenizer.
 *
 * Primary path: `Intl.Segmenter("zh", { granularity: "word" })` — ICU's
 * dictionary-driven dynamic-programming word segmentation, built into the
 * JavaScript engine, zero dependencies, fully on-device. It divides
 * 「周六那家店订到位子了」 into 周六 / 那 / 家 / 店 / 订到 / 位子 / 了 instead
 * of blind character n-grams, which sharpens BM25 term statistics (IDF over
 * real words) and lexical-overlap scoring.
 *
 * Recall supplement: Han character bigrams are appended so partial or novel
 * words (names, memes the dictionary has never seen) still match.
 *
 * Fallback: engines without a zh segmenter get the original n-gram scheme, so
 * behavior degrades instead of breaking.
 *
 * Deliberately NOT used for the 384-d hashed embeddings that back stored
 * material-memory vectors — those keep their original token space so vectors
 * written by earlier versions stay comparable.
 */

let cachedSegmenter: Intl.Segmenter | null | undefined;

function segmenter(): Intl.Segmenter | null {
  if (cachedSegmenter === undefined) {
    try {
      cachedSegmenter = new Intl.Segmenter("zh", { granularity: "word" });
    } catch {
      cachedSegmenter = null;
    }
  }
  return cachedSegmenter;
}

export function segmenterAvailable(): boolean {
  return segmenter() !== null;
}

/** Dictionary word segmentation (lowercased, NFKC). ASCII runs come back as
 * whole words; Han text as dictionary words (single-character words included —
 * BM25's IDF discounts ubiquitous ones naturally). */
export function segmentWords(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const seg = segmenter();
  const words: string[] = [];
  if (seg) {
    for (const part of seg.segment(normalized)) {
      if (!part.isWordLike) continue;
      const word = part.segment.trim();
      if (!word) continue;
      if (/^[a-z0-9]+$/.test(word) && word.length < 2) continue;
      words.push(word);
      if (words.length >= 500) break;
    }
    return words;
  }
  // Fallback: ASCII words + Han bigrams (the pre-segmenter scheme).
  for (const word of normalized.match(/[a-z0-9]{2,}/g) ?? []) words.push(word);
  for (const run of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let i = 0; i < run.length - 1 && words.length < 500; i += 1) {
      words.push(run.slice(i, i + 2));
    }
  }
  return words;
}

/** Retrieval tokens: dictionary words plus Han bigrams for recall. */
export function retrievalTokens(text: string): string[] {
  const tokens = segmentWords(text);
  const normalized = text.normalize("NFKC").toLowerCase();
  for (const run of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    for (let i = 0; i < run.length - 1 && tokens.length < 700; i += 1) {
      tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}
