# The English playbook

Junshi ships two playbooks: one for chats in Chinese (`references/*.md`) and one for chats in English (`references/en/*.md`). The English one is written from scratch for how people text and date in the US, UK, Canada and Australia. It is not a translation of the Chinese one.

Each chat loads exactly one set. A profile's chat language picks it (Settings → per-profile "What language do you text in?"; the default follows the app language). If the app is in Chinese and the chat is in English, the model gets the English playbook plus one line telling it to write its commentary in Chinese. That is the only crossover.

## What changes between the two

| | Chinese playbook | English playbook |
| --- | --- | --- |
| Where the chat happens | WeChat, 朋友圈, 小红书 | iMessage, Instagram DMs, WhatsApp, Hinge / Bumble / Tinder |
| Stages | 初识 → 暧昧 → 追求 → 告白确认 → 热恋… | Just met → Talking stage → Dating (not exclusive by default) → About to DTR → Honeymoon… |
| Making it official | 表白, often a set-piece moment | A "what are we?" talk, in person, framed as what you want |
| Punctuation | A trailing 句号 reads cold | A trailing period reads cold too, but one "!" reads warm, and all-lowercase reads relaxed |
| Laughing | 哈哈 vs 哈哈哈哈哈, 笑死 | lol / LMAO / 💀 / 😭, and 😂 reads a little millennial |
| Pursuit | Some persistence (追) is expected | One clean ask, then hand the ball back; double texting once is fine, twice is a signal |
| Who asks | Mostly the man, still | Either; on some apps women message first |
| Seeing other people early | A warning sign | Normal before the exclusivity talk; the player score looks at patterns, not app activity |
| Dates that matter | 520, 七夕, 情人节, 国庆, 春节 | Valentine's, Galentine's, cuffing season, Halloween, Thanksgiving, NYE |
| The bill | Often he pays, or 红包 / transfers | Whoever asked offers; "you get the next one" if they insist on splitting |
| Dated slang | 绝绝子, YYDS, 泰裤辣 | on fleek, YOLO, bae, squad goals, "very demure" |

The hard rules are the same in both. Judge by actions, not sweet talk. Take the user's side. Skip the moralizing. The thirst caps and Reality-check thresholds are identical for men and women.

## The files

| File | What it covers |
| --- | --- |
| `core.md` | Whose side Junshi is on, the output contract (Steady / Flirt / Wildcard), nerve |
| `voice.md` | Texting physics: punctuation, bubbles, the laugh ladder, emoji with two meanings, flirting register |
| `memes.md` | Scan slang first; how to mirror it without trying too hard; GIF ideas |
| `reading.md` | Decoding a message, the four interest dimensions, Reality-check thresholds, the player score |
| `strategy.md` | Stages and thirst caps, pacing, pursuit types for dating women and dating men, the line library |
| `dating.md` | Asking someone out, holidays, gifts and the bill, making a date memorable |
| `profile.md` | Reading screenshots and profiles: bubble colors, Hinge prompts, bios |
| `glossary.md` | The slang scanner and the vibe check's blacklist in one file, with a check date on every row |

## The vibe check

Every copyable message runs through `lintEn` in `app/src/core/voice.ts` before it reaches you. These fail and get rewritten:

- a period ending a short text, a lone "k"
- dead slang from section D of the glossary, "u up", "m'lady"
- email voice ("hope this message finds you", "kind regards"), essay words ("furthermore", "therefore")
- talking down ("calm down", "no offense but", "you're overthinking")
- one text longer than 25 words

These get flagged: "you should", therapy-speak ("that's so valid"), "wyd", interview openers ("how was your day today"), "good morning beautiful" early on, 🙂, 😂, stacked "!!", trailing "...", a whole sentence in caps, more than three bubbles.

## Keeping the slang current

Slang ages fast. Each row in `glossary.md` has a "Checked" month. Anything older than 12 months should be re-checked before the model leans on it, and terms move from A (fresh) to C (aging) to D (dead) rather than being deleted. Editing the file changes the app; no code changes needed.

Common words that are also slang ("cooked", "bet", "mid", "fire") are left out of automatic matching so "I cooked dinner" doesn't get annotated. The model still reads them in context.
