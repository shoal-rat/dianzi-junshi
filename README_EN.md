<p align="center"><img src="assets/v6-icon.png" width="96" alt="Dianzi Junshi"></p>

<h1 align="center">电子军师 · Dianzi Junshi</h1>

<p align="center">Your electronic wingman for Chinese dating chats. Paste what they said — get three ready-to-send replies.</p>

![Main screen: vermilion annotations on the partner's words, three stamped reply plans, the strategy card and the dossier](assets/v6-home.jpg)

Dianzi Junshi ("electronic military strategist") is a local-first desktop app for young Chinese speakers navigating dating chats on WeChat and elsewhere. Paste a message or drop a screenshot and it will:

1. **Scan for memes first** — 「那咋了」 is playful defiance, not anger. Reading the words is not the same as getting the joke.
2. **Read the situation** — surface, emotion, real need; sweetness, initiative, commitment, and follow-through scored separately; a 海王 (player) index reported honestly.
3. **Hand you three plans** — 稳 (safe), 撩 (flirty, within the stage's "oiliness" cap), 奇 (a third path: show yourself, be sincere, joke, cool down, or push forward). Each is text you can copy and send as-is, and the recommended one gets a 「荐」 seal.
4. **Remember them** — birthday, food taboos, catchphrases, the memes they use, and which of your moves landed or went cold.

Every copyable reply passes a youth-voice gate: no trailing full stops, no "drink more hot water", no lecturing, no stale memes, no 36-character essays.

## Anti-player mode, both ways

With clear-eyed mode on, the counselor judges by actions — late-night-only warmth, "next time" with no date, warming up only when you pull back, showing up only when they need a favor — and when a hard threshold trips, it stamps 「醒」 and tells you to stop investing, with a graceful exit line. Same rules for men and women.

| A woman asking about a male player | A man asking about a female player |
| --- | --- |
| ![Male player case](assets/v6-anti-player-male.jpg) | ![Female player case](assets/v6-anti-player-female.jpg) |

## Details

- **Modes**: 怎么回 (how to reply), 读懂 ta (just decode it), 帮我改 (check my draft), 有没有戏 (is this going anywhere).
- **Nerve**: five gears per person, from 很稳 (very safe) to 放胆冲 (go for it). Nerve changes how much risk you take, never the read.
- **Gender (optional)**: set the partner's and your own so pronouns and the pursuit playbooks match; leave it blank and the counselor infers from the chat.
- **Learning**: one tap after you send — landed / meh / went cold / no reply — builds per-plan records, a "don't repeat" list, and a profile of how you actually text.
- **AI connections**: Codex or Claude Code (reuses your login, no key), Claude API (official SDK, default Claude Opus 5.5, prompt caching, server-side refusal fallback), DeepSeek, GLM, any OpenAI-compatible endpoint, or an offline demo. Keys live in the OS keychain.
- **Design language 「朱批」**: rice paper, ink, and a strategist's vermilion brush — annotations drawn on the partner's words, stamped plans, and an ink-night dark theme.
- **Privacy**: everything stays in `~/.dianzi-junshi/`; the server binds to 127.0.0.1 and rejects non-local origins.

The full strategy doctrine lives in [`references/`](references) (Chinese) and is embedded into the app at build time.

## Install / develop

Download from [Releases](https://github.com/shoal-rat/dianzi-junshi/releases). To run from source with Bun 1.3+:

```bash
cd app && bun install && bun run start
```

`bun run verify` typechecks, runs 54 tests, and compiles the single-file backend. The Tauri 2 shell lives in [`desktop/`](desktop).

Chinese README: [README.md](README.md)
