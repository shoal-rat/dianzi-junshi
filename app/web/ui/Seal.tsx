/**
 * 印。白文（红底白字）用于锦囊的「稳 / 撩 / 奇」，朱文（白底红字红框）用于「荐」这类批注章。
 * 毛边和飞白来自一次定义的 SVG 滤镜，所以每个印都像真盖上去的。
 */

import type { JSX } from "preact";

export function SealDefs() {
  return (
    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <defs>
        <filter id="seal-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.16" numOctaves="3" seed="3" result="speck" />
          <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -22 16.2" result="mask" />
          <feComposite in="rough" in2="mask" operator="in" />
        </filter>
        <filter id="brush-rough" x="-2%" y="-20%" width="104%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.6 2.2" numOctaves="2" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3" />
        </filter>
      </defs>
    </svg>
  );
}

type Tone = "zhu" | "ink" | "jade" | "ochre" | "dai";

export function Seal(props: {
  char: string;
  size?: number;
  variant?: "solid" | "line";
  tone?: Tone;
  tilt?: number;
  class?: string;
  title?: string;
}) {
  const { char, size = 34, variant = "solid", tone = "zhu", tilt = 0, title } = props;
  const color = `var(--${tone})`;
  const paper = "var(--zhu-on)";
  const chars = [...char];
  const fill = variant === "solid" ? paper : color;
  const glyph = (ch: string, x: number, y: number, fs: number, key: number) => (
    <text key={key} x={x} y={y} font-size={fs} text-anchor="middle" dominant-baseline="central" fill={fill}
      style="font-family:var(--font-display);font-weight:900">{ch}</text>
  );
  let glyphs: JSX.Element[];
  if (chars.length === 1) glyphs = [glyph(chars[0], 50, 52, 64, 0)];
  else if (chars.length === 2) glyphs = [glyph(chars[0], 50, 29, 40, 0), glyph(chars[1], 50, 72, 40, 1)];
  else {
    // 四字印：右列从上到下，再左列（电子 / 军师）
    glyphs = [glyph(chars[0], 71, 29, 38, 0), glyph(chars[1], 71, 71, 38, 1), glyph(chars[2] ?? "", 29, 29, 38, 2), glyph(chars[3] ?? "", 29, 71, 38, 3)];
  }
  return (
    <svg class={`seal ${props.class ?? ""}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title ?? char}
      style={tilt ? `transform:rotate(${tilt}deg)` : undefined}>
      {title ? <title>{title}</title> : null}
      <g filter="url(#seal-rough)">
        {variant === "solid" ? (
          <>
            <rect x="3" y="3" width="94" height="94" rx="7" fill={color} />
            <rect x="10" y="10" width="80" height="80" rx="3" fill="none" stroke={paper} stroke-width="2.5" opacity="0.9" />
          </>
        ) : (
          <rect x="6" y="6" width="88" height="88" rx="6" fill="none" stroke={color} stroke-width="7" />
        )}
        {glyphs}
      </g>
    </svg>
  );
}

/** 朱笔横划：分隔、强调用的一笔。 */
export function Brush(props: { width?: number; class?: string }) {
  const w = props.width ?? 72;
  return (
    <svg class={`brush ${props.class ?? ""}`} width={w} height="10" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 6.2 C 18 3.6, 40 4.4, 58 4.9 S 88 5.8, 98 3.8" stroke="var(--zhu)" stroke-width="3.2" fill="none" stroke-linecap="round" filter="url(#brush-rough)" />
    </svg>
  );
}
