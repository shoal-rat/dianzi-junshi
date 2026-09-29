/** 够用的小 Markdown：段落、列表、标题、引用、粗体、行内代码。输出全是文本节点，天然转义。 */

import type { ComponentChildren } from "preact";

function inline(text: string, key = 0): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|「[^」]{1,40}」)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={`${key}-${i++}`}>{tok.slice(1, -1)}</code>);
    else out.push(<span class="quote-mark" key={`${key}-${i++}`}>{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ComponentChildren[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} class="md-pre">{body.join("\n")}</pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push(<h4 key={k++} class="md-h">{inline(h[2], k)}</h4>); i++; continue; }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push(<ul key={k++} class="md-ul">{items.map((it, j) => <li key={j}>{inline(it, j)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.、)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.、)]\s+/, ""));
      blocks.push(<ol key={k++} class="md-ol">{items.map((it, j) => <li key={j}>{inline(it, j)}</li>)}</ol>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={k++} class="md-q">{inline(q.join(" "), k)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.、)]|#{1,4}\s|>|```)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} class="md-p">{para.flatMap((p, j) => (j ? [<br key={`b${j}`} />, ...inline(p, j)] : inline(p, j)))}</p>);
  }
  return <div class="md">{blocks}</div>;
}
