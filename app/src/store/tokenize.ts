/**
 * 中文检索分词：ICU 词典分词（Intl.Segmenter，Bun 内建）+ 汉字二元组补召回。
 * 「周六那家店订到位子了」→ 周六 / 那家 / 店 / 订到 / 位子 + 周六 六那 那家 …
 */

const STOP = new Set([
  "的", "了", "吗", "呢", "吧", "啊", "呀", "哦", "嗯", "是", "我", "你", "他", "她", "它", "我们", "你们", "他们",
  "这", "那", "就", "也", "都", "还", "在", "有", "和", "跟", "很", "太", "又", "被", "把", "给", "让", "说", "要", "会",
  "一个", "什么", "怎么", "这个", "那个", "没有", "不是", "就是", "然后", "因为", "所以", "可以", "现在",
]);

let segmenter: Intl.Segmenter | null = null;
try { segmenter = new Intl.Segmenter("zh", { granularity: "word" }); } catch { segmenter = null; }

const HAN = /[一-鿿]/;

export function words(text: string): string[] {
  const clean = text.toLowerCase().normalize("NFKC");
  const out: string[] = [];
  if (segmenter) {
    for (const s of segmenter.segment(clean)) {
      if (!s.isWordLike) continue;
      const w = s.segment.trim();
      if (!w || STOP.has(w)) continue;
      if (w.length === 1 && !HAN.test(w)) continue;
      out.push(w);
    }
  } else {
    for (const w of clean.split(/[^\p{L}\p{N}]+/u)) if (w && !STOP.has(w)) out.push(w);
  }
  return out;
}

export function tokens(text: string): string[] {
  const out = words(text);
  const runs = text.normalize("NFKC").match(/[一-鿿]{2,}/g) ?? [];
  for (const run of runs) for (let i = 0; i + 1 < run.length; i++) out.push(`${run[i]}${run[i + 1]}`);
  return out;
}

export function bigramSet(text: string): Set<string> {
  const s = text.replace(/\s+/g, "").toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

/** 两段短文字的字面相似度（Dice 系数），用于档案事实去重。 */
export function similarity(a: string, b: string): number {
  const x = bigramSet(a);
  const y = bigramSet(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const g of x) if (y.has(g)) inter++;
  return (2 * inter) / (x.size + y.size);
}
