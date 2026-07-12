/**
 * Temporal convolutional response predictor, in pure TypeScript.
 *
 * The structural response head (worldmodel.ts) sees only a summary of the
 * present state, so it is blind to temporal shape: momentum that is rising vs
 * fading, silence gaps, pressure spikes that follow invitations. This module
 * adds a small 1-D CNN over the raw observation timeline:
 *
 *   input   X ∈ R^{10×16}: 9 belief dimensions bucketed over the last 45 days
 *           (2.8-day buckets, confidence·reliability-weighted means) plus one
 *           observation-density channel
 *   conv1   10→12 channels, kernel 3, valid padding, ReLU
 *   conv2   12→12 channels, kernel 3, valid padding, ReLU   (receptive field
 *           5 buckets ≈ 14 days)
 *   GAP     global average pool over time
 *   dense   [12 pooled ⊕ 6 action features ⊕ 4 regime posterior] → 16 → 4
 *   output  softmax over the four response classes
 *
 * ~1.3k parameters. Training (class-weighted cross-entropy + L2, Adam) runs in
 * milliseconds on the data volumes this app sees, entirely on-device, with a
 * seeded PRNG so replay reproduces identical weights. The predictor only
 * influences decisions through a holdout log-loss gate (store.ts): if it does
 * not beat the existing head on withheld outcomes, its mixture weight is zero.
 */

import { BELIEF_DIMENSIONS, type BeliefDimension } from "./types";

export const GRID_CHANNELS = 10;
export const GRID_STEPS = 16;
export const GRID_WINDOW_DAYS = 45;
export const EXTRA_FEATURES = 10; // 6 action features + 4 regime probabilities
export const RESPONSE_COUNT = 4;

export interface GridObservation {
  dimension: BeliefDimension;
  value: number;
  confidence: number;
  reliability: number;
  observedAt: string;
}

/** Featurize the raw observation timeline: 9 dimension channels of
 * confidence·reliability-weighted bucket means over the last 45 days
 * (2.8-day buckets) plus one observation-density channel. Empty cells stay 0,
 * so silence gaps are visible to the convolution — they carry signal here. */
export function buildObservationGrid(observations: GridObservation[], at: string | number): number[] {
  const end = typeof at === "number" ? at : Date.parse(at);
  const windowMs = GRID_WINDOW_DAYS * 86_400_000;
  const bucketMs = windowMs / GRID_STEPS;
  const sums = new Array<number>(9 * GRID_STEPS).fill(0);
  const masses = new Array<number>(9 * GRID_STEPS).fill(0);
  const counts = new Array<number>(GRID_STEPS).fill(0);
  for (const obs of observations) {
    const ts = Date.parse(obs.observedAt);
    const age = end - ts;
    if (!Number.isFinite(ts) || age < 0 || age >= windowMs) continue;
    const bucket = GRID_STEPS - 1 - Math.min(GRID_STEPS - 1, Math.floor(age / bucketMs));
    const dim = BELIEF_DIMENSIONS.indexOf(obs.dimension);
    if (dim < 0) continue;
    const weight = Math.max(0, obs.confidence) * Math.max(0, obs.reliability);
    sums[dim * GRID_STEPS + bucket] += obs.value * weight;
    masses[dim * GRID_STEPS + bucket] += weight;
    counts[bucket] += 1;
  }
  const grid = new Array<number>(GRID_CHANNELS * GRID_STEPS).fill(0);
  for (let d = 0; d < 9; d += 1) {
    for (let t = 0; t < GRID_STEPS; t += 1) {
      const mass = masses[d * GRID_STEPS + t];
      grid[d * GRID_STEPS + t] = mass ? Math.max(-1, Math.min(1, sums[d * GRID_STEPS + t] / mass)) : 0;
    }
  }
  for (let t = 0; t < GRID_STEPS; t += 1) {
    grid[9 * GRID_STEPS + t] = Math.min(1, counts[t] / 3);
  }
  return grid;
}

const CONV1_OUT = 12;
const CONV2_OUT = 12;
const KERNEL = 3;
const T1 = GRID_STEPS - KERNEL + 1;      // 14
const T2 = T1 - KERNEL + 1;              // 12
const DENSE_IN = CONV2_OUT + EXTRA_FEATURES;
const DENSE_HIDDEN = 16;

export interface CnnWeights {
  conv1w: number[]; conv1b: number[];
  conv2w: number[]; conv2b: number[];
  d1w: number[]; d1b: number[];
  d2w: number[]; d2b: number[];
}

export interface TrainingExample {
  /** Channel-major flattened grid: grid[c * GRID_STEPS + t]. */
  grid: number[];
  /** Action features (6) followed by regime posterior (4). */
  extra: number[];
  /** Response class index: 0 positive, 1 neutral, 2 negative, 3 no_reply. */
  label: number;
}

/** Deterministic PRNG (mulberry32) so training is replayable byte-for-byte. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function heInit(count: number, fanIn: number, rand: () => number): number[] {
  const scale = Math.sqrt(2 / fanIn);
  // Box–Muller from the seeded uniform source keeps init deterministic.
  const out = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    const u = Math.max(1e-12, rand());
    const v = rand();
    out[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * scale;
  }
  return out;
}

export function initWeights(seed = 7): CnnWeights {
  const rand = seededRandom(seed);
  return {
    conv1w: heInit(CONV1_OUT * GRID_CHANNELS * KERNEL, GRID_CHANNELS * KERNEL, rand),
    conv1b: new Array(CONV1_OUT).fill(0),
    conv2w: heInit(CONV2_OUT * CONV1_OUT * KERNEL, CONV1_OUT * KERNEL, rand),
    conv2b: new Array(CONV2_OUT).fill(0),
    d1w: heInit(DENSE_HIDDEN * DENSE_IN, DENSE_IN, rand),
    d1b: new Array(DENSE_HIDDEN).fill(0),
    d2w: heInit(RESPONSE_COUNT * DENSE_HIDDEN, DENSE_HIDDEN, rand),
    d2b: new Array(RESPONSE_COUNT).fill(0),
  };
}

export function parameterCount(): number {
  return CONV1_OUT * GRID_CHANNELS * KERNEL + CONV1_OUT
    + CONV2_OUT * CONV1_OUT * KERNEL + CONV2_OUT
    + DENSE_HIDDEN * DENSE_IN + DENSE_HIDDEN
    + RESPONSE_COUNT * DENSE_HIDDEN + RESPONSE_COUNT;
}

interface ForwardCache {
  x: number[];
  y1: number[]; a1: number[]; // conv1 pre/post ReLU, [CONV1_OUT × T1]
  y2: number[]; a2: number[]; // conv2 pre/post ReLU, [CONV2_OUT × T2]
  pooled: number[];           // [DENSE_IN]
  h: number[]; ah: number[];  // dense1 pre/post ReLU
  logits: number[];
  probs: number[];
}

function conv1dForward(
  x: number[], inCh: number, inT: number,
  w: number[], b: number[], outCh: number,
): number[] {
  const outT = inT - KERNEL + 1;
  const y = new Array<number>(outCh * outT).fill(0);
  for (let o = 0; o < outCh; o += 1) {
    for (let t = 0; t < outT; t += 1) {
      let sum = b[o];
      for (let i = 0; i < inCh; i += 1) {
        const wBase = (o * inCh + i) * KERNEL;
        const xBase = i * inT + t;
        for (let k = 0; k < KERNEL; k += 1) sum += w[wBase + k] * x[xBase + k];
      }
      y[o * outT + t] = sum;
    }
  }
  return y;
}

function relu(values: number[]): number[] {
  return values.map((v) => (v > 0 ? v : 0));
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map((z) => Math.exp(z - max));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / total);
}

function forward(w: CnnWeights, grid: number[], extra: number[]): ForwardCache {
  const y1 = conv1dForward(grid, GRID_CHANNELS, GRID_STEPS, w.conv1w, w.conv1b, CONV1_OUT);
  const a1 = relu(y1);
  const y2 = conv1dForward(a1, CONV1_OUT, T1, w.conv2w, w.conv2b, CONV2_OUT);
  const a2 = relu(y2);
  const pooled = new Array<number>(DENSE_IN).fill(0);
  for (let c = 0; c < CONV2_OUT; c += 1) {
    let sum = 0;
    for (let t = 0; t < T2; t += 1) sum += a2[c * T2 + t];
    pooled[c] = sum / T2;
  }
  for (let i = 0; i < EXTRA_FEATURES; i += 1) pooled[CONV2_OUT + i] = extra[i] ?? 0;
  const h = new Array<number>(DENSE_HIDDEN).fill(0);
  for (let j = 0; j < DENSE_HIDDEN; j += 1) {
    let sum = w.d1b[j];
    for (let i = 0; i < DENSE_IN; i += 1) sum += w.d1w[j * DENSE_IN + i] * pooled[i];
    h[j] = sum;
  }
  const ah = relu(h);
  const logits = new Array<number>(RESPONSE_COUNT).fill(0);
  for (let o = 0; o < RESPONSE_COUNT; o += 1) {
    let sum = w.d2b[o];
    for (let j = 0; j < DENSE_HIDDEN; j += 1) sum += w.d2w[o * DENSE_HIDDEN + j] * ah[j];
    logits[o] = sum;
  }
  return { x: grid, y1, a1, y2, a2, pooled, h, ah, logits, probs: softmax(logits) };
}

export function predictResponse(w: CnnWeights, grid: number[], extra: number[]): number[] {
  return forward(w, grid, extra).probs;
}

type Grads = CnnWeights;

function zeroGrads(): Grads {
  return {
    conv1w: new Array(CONV1_OUT * GRID_CHANNELS * KERNEL).fill(0),
    conv1b: new Array(CONV1_OUT).fill(0),
    conv2w: new Array(CONV2_OUT * CONV1_OUT * KERNEL).fill(0),
    conv2b: new Array(CONV2_OUT).fill(0),
    d1w: new Array(DENSE_HIDDEN * DENSE_IN).fill(0),
    d1b: new Array(DENSE_HIDDEN).fill(0),
    d2w: new Array(RESPONSE_COUNT * DENSE_HIDDEN).fill(0),
    d2b: new Array(RESPONSE_COUNT).fill(0),
  };
}

/** Accumulates ∂loss/∂θ for one example into `g`. Returns the example loss.
 * Label smoothing keeps small-sample nets from becoming confidently wrong —
 * critical here because the holdout gate punishes miscalibration in nats. */
function backward(w: CnnWeights, g: Grads, example: TrainingExample, classWeight: number, smoothing = 0): number {
  const cache = forward(w, example.grid, example.extra);
  const target = new Array<number>(RESPONSE_COUNT).fill(smoothing / RESPONSE_COUNT);
  target[example.label] += 1 - smoothing;
  let loss = 0;
  for (let o = 0; o < RESPONSE_COUNT; o += 1) {
    loss += -classWeight * target[o] * Math.log(Math.max(1e-12, cache.probs[o]));
  }

  // dL/dlogits for weighted cross-entropy with softmax and smoothed targets
  const dLogits = cache.probs.map((p, o) => classWeight * (p - target[o]));

  const dAh = new Array<number>(DENSE_HIDDEN).fill(0);
  for (let o = 0; o < RESPONSE_COUNT; o += 1) {
    g.d2b[o] += dLogits[o];
    for (let j = 0; j < DENSE_HIDDEN; j += 1) {
      g.d2w[o * DENSE_HIDDEN + j] += dLogits[o] * cache.ah[j];
      dAh[j] += dLogits[o] * w.d2w[o * DENSE_HIDDEN + j];
    }
  }
  const dH = dAh.map((v, j) => (cache.h[j] > 0 ? v : 0));
  const dPooled = new Array<number>(DENSE_IN).fill(0);
  for (let j = 0; j < DENSE_HIDDEN; j += 1) {
    g.d1b[j] += dH[j];
    for (let i = 0; i < DENSE_IN; i += 1) {
      g.d1w[j * DENSE_IN + i] += dH[j] * cache.pooled[i];
      dPooled[i] += dH[j] * w.d1w[j * DENSE_IN + i];
    }
  }

  // GAP backward: spread evenly over time, then ReLU mask of conv2
  const dY2 = new Array<number>(CONV2_OUT * T2).fill(0);
  for (let c = 0; c < CONV2_OUT; c += 1) {
    const share = dPooled[c] / T2;
    for (let t = 0; t < T2; t += 1) {
      dY2[c * T2 + t] = cache.y2[c * T2 + t] > 0 ? share : 0;
    }
  }

  // conv2 backward
  const dA1 = new Array<number>(CONV1_OUT * T1).fill(0);
  for (let o = 0; o < CONV2_OUT; o += 1) {
    for (let t = 0; t < T2; t += 1) {
      const dy = dY2[o * T2 + t];
      if (dy === 0) continue;
      g.conv2b[o] += dy;
      for (let i = 0; i < CONV1_OUT; i += 1) {
        const wBase = (o * CONV1_OUT + i) * KERNEL;
        const aBase = i * T1 + t;
        for (let k = 0; k < KERNEL; k += 1) {
          g.conv2w[wBase + k] += dy * cache.a1[aBase + k];
          dA1[aBase + k] += dy * w.conv2w[wBase + k];
        }
      }
    }
  }
  const dY1 = dA1.map((v, idx) => (cache.y1[idx] > 0 ? v : 0));

  // conv1 backward (input gradients are not needed)
  for (let o = 0; o < CONV1_OUT; o += 1) {
    for (let t = 0; t < T1; t += 1) {
      const dy = dY1[o * T1 + t];
      if (dy === 0) continue;
      g.conv1b[o] += dy;
      for (let i = 0; i < GRID_CHANNELS; i += 1) {
        const wBase = (o * GRID_CHANNELS + i) * KERNEL;
        const xBase = i * GRID_STEPS + t;
        for (let k = 0; k < KERNEL; k += 1) {
          g.conv1w[wBase + k] += dy * cache.x[xBase + k];
        }
      }
    }
  }
  return loss;
}

const PARAM_KEYS: Array<keyof CnnWeights> = [
  "conv1w", "conv1b", "conv2w", "conv2b", "d1w", "d1b", "d2w", "d2b",
];

export interface TrainOptions {
  seed?: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  /** Soft targets: (1−ε) on the label, ε/4 elsewhere. Default .06. */
  labelSmoothing?: number;
  /** Balance rare classes; computed from label frequencies when omitted. */
  classWeights?: number[];
}

export interface TrainResult {
  weights: CnnWeights;
  finalLoss: number;
  epochs: number;
}

/** Inverse-frequency class weights, clipped so no class dominates the loss. */
export function balancedClassWeights(examples: TrainingExample[]): number[] {
  const counts = new Array<number>(RESPONSE_COUNT).fill(0);
  for (const example of examples) counts[example.label] += 1;
  const total = examples.length || 1;
  return counts.map((c) => Math.min(4, total / (RESPONSE_COUNT * Math.max(1, c))));
}

export function trainCnn(examples: TrainingExample[], options: TrainOptions = {}): TrainResult {
  const seed = options.seed ?? 7;
  const epochs = options.epochs ?? 220;
  const lr = options.learningRate ?? .012;
  const l2 = options.l2 ?? 1e-3;
  const smoothing = Math.max(0, Math.min(.2, options.labelSmoothing ?? .06));
  const classWeights = options.classWeights ?? balancedClassWeights(examples);
  const weights = initWeights(seed);
  const m = zeroGrads();
  const v = zeroGrads();
  const beta1 = .9;
  const beta2 = .999;
  const rand = seededRandom(seed ^ 0x9e3779b9);
  let step = 0;
  let lastLoss = Number.POSITIVE_INFINITY;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    // Deterministic Fisher–Yates shuffle per epoch
    const order = examples.map((_, index) => index);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let epochLoss = 0;
    // Full-batch gradient per epoch keeps updates stable on tiny datasets.
    const grads = zeroGrads();
    for (const index of order) {
      epochLoss += backward(weights, grads, examples[index], classWeights[examples[index].label], smoothing);
    }
    const n = examples.length;
    step += 1;
    for (const key of PARAM_KEYS) {
      const wArr = weights[key];
      const gArr = grads[key];
      const mArr = m[key];
      const vArr = v[key];
      for (let i = 0; i < wArr.length; i += 1) {
        const grad = gArr[i] / n + l2 * wArr[i];
        mArr[i] = beta1 * mArr[i] + (1 - beta1) * grad;
        vArr[i] = beta2 * vArr[i] + (1 - beta2) * grad * grad;
        const mHat = mArr[i] / (1 - Math.pow(beta1, step));
        const vHat = vArr[i] / (1 - Math.pow(beta2, step));
        wArr[i] -= lr * mHat / (Math.sqrt(vHat) + 1e-8);
      }
    }
    lastLoss = epochLoss / n;
  }
  return { weights, finalLoss: lastLoss, epochs };
}

/** Mean negative log-likelihood of the true labels (unweighted, in nats). */
export function meanLogLoss(weights: CnnWeights, examples: TrainingExample[]): number {
  if (!examples.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (const example of examples) {
    const probs = predictResponse(weights, example.grid, example.extra);
    total += -Math.log(Math.max(1e-12, probs[example.label]));
  }
  return total / examples.length;
}

/** Analytic-vs-numeric gradient agreement on a tiny sample; used by tests to
 * guard the hand-written backward pass. Returns the worst relative error. */
export function gradientCheck(seed = 3, probes = 6): number {
  const rand = seededRandom(seed);
  const example: TrainingExample = {
    grid: Array.from({ length: GRID_CHANNELS * GRID_STEPS }, () => rand() * 2 - 1),
    extra: Array.from({ length: EXTRA_FEATURES }, () => rand()),
    label: Math.floor(rand() * RESPONSE_COUNT),
  };
  const weights = initWeights(seed);
  const grads = zeroGrads();
  backward(weights, grads, example, 1);
  let worst = 0;
  const eps = 1e-5;
  for (const key of PARAM_KEYS) {
    for (let probe = 0; probe < probes; probe += 1) {
      const index = Math.floor(rand() * weights[key].length);
      const original = weights[key][index];
      weights[key][index] = original + eps;
      const up = -Math.log(Math.max(1e-12, forward(weights, example.grid, example.extra).probs[example.label]));
      weights[key][index] = original - eps;
      const down = -Math.log(Math.max(1e-12, forward(weights, example.grid, example.extra).probs[example.label]));
      weights[key][index] = original;
      const numeric = (up - down) / (2 * eps);
      const analytic = grads[key][index];
      const scale = Math.max(1e-4, Math.abs(numeric), Math.abs(analytic));
      worst = Math.max(worst, Math.abs(numeric - analytic) / scale);
    }
  }
  return worst;
}
