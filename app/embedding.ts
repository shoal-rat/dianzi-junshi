/**
 * Feature-hashed text embedding on top of the segmenting tokenizer.
 *
 * One embedding space for everything: material memory cards, decision-evidence
 * retrieval, query vectors. Tokens come from ICU dictionary segmentation with
 * Han-bigram recall (decision/tokenize.ts), so 「周五 friday 见」 and mixed
 * Chinese-English text land on real word buckets. Signed FNV-1a hashing into
 * 384 dimensions, L2-normalized — a Johnson–Lindenstrauss-style sketch that
 * needs no model download and runs in microseconds.
 *
 * Stored material vectors are re-embedded once by a startup migration
 * (adaptive.ts, migration v6), so there is exactly one token space on disk.
 */

import { retrievalTokens } from "./decision/tokenize";

export const VECTOR_DIMS = 384;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function embedText(text: string): Float32Array {
  const vector = new Float32Array(VECTOR_DIMS);
  for (const token of retrievalTokens(text)) {
    const hash = fnv1a(token);
    const index = hash % VECTOR_DIMS;
    const sign = (hash & 0x80000000) === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.min(2, token.length / 4));
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

export function vectorize(text: string): string {
  return Buffer.from(embedText(text).buffer).toString("base64");
}

export function decodeVector(encoded: string): Float32Array {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength !== VECTOR_DIMS * 4) return new Float32Array(VECTOR_DIMS);
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let score = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) score += a[i] * b[i];
  return Math.max(-1, Math.min(1, score));
}
