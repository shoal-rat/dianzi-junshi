# Dianzi Junshi

<div align="center">

**A Chinese dating-chat strategist for people who need help showing themselves, flirting lightly, and knowing when to stop.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/platform-Claude_Code-blue)](https://claude.ai/code)
[![Codex](https://img.shields.io/badge/platform-Codex-0F766E)](platforms/codex.md)
[![ChatGPT](https://img.shields.io/badge/platform-ChatGPT-10A37F)](platforms/chatgpt-instructions.md)
[![中文](https://img.shields.io/badge/中文-README.md-red)](README.md)

</div>

---

**Dianzi Junshi** (电子军师, “Electronic Strategist”) is a Claude Code / Codex / ChatGPT skill for Chinese dating and relationship chats.

It helps users:

- understand what a message may really mean,
- draft natural replies that sound like the user,
- keep “oiliness” low while still being playful,
- judge whether the other person is actually interested,
- analyze Moments/social screenshots,
- auto-import a folder of chats, screenshots, photos, and notes,
- plan dates with user-only reminders separated from copyable replies,
- and stop over-investing when the signals are clearly bad.

The core strategy:

> Show yourself first. Flirt lightly. Watch whether they catch the signal. If they do not, cool down. If they are clearly not interested, leave with dignity.

This is not a PUA script. It refuses coercion, deception, jealousy-baiting, stalking, privacy probing, threats, and emotional manipulation.

---

## Features

### Three-layer message reading

```text
Surface: what they literally said
Emotion: what they may be feeling
Need: what they may want from you
```

The skill separates evidence from inference so it does not over-read a single message.

### Oiliness control

“油腻度” is a Chinese internet term for overdoing intimacy, neediness, or clingy pressure.

| Stage | Cap | Guidance |
| --- | --- | --- |
| Just met / flirting | 0-1.5/5 | show yourself, hint lightly, do not reveal too much |
| Pursuing / confirming | 2-2.5/5 | be active, but do not force an answer |
| Early / stable relationship | 3-3.5/5 | sweet and playful is fine, but do not repeat the same sugar |
| Friction / crisis | 0.5-1.5/5 | cool down, keep boundaries and dignity |

### Default reply options

`/reply` usually returns:

- **Safe version**: low-risk, not awkward.
- **Flirty version**: playful, but under the oiliness cap.
- **Self-display / sincere / de-escalation version**: chosen by context.

### Interest detection

`/interest` scores interest from `0-10` using chat evidence:

- Initiating contact, asking questions, remembering details, catching jokes, accepting dates or offering alternatives: up.
- Polite one-word replies, no follow-up, repeated date rejection without alternatives, only coming for favors: down.

It looks for patterns, not one slow reply.

### Anti-simp mode

Turn it on during onboarding or with:

```text
/anti-simp on
```

When signals are clearly bad, the skill gets direct:

```text
This is not worth more investment right now.
Stop chasing, pull attention back, and leave the interaction gracefully.
```

### Auto folder import

Users do not need to classify materials manually.

```text
/import-folder C:\Users\me\Desktop\ta-materials
```

The skill scans and classifies:

- chat logs,
- Moments/social screenshots,
- selfie/outfit/makeup/avatar images,
- notes,
- unknown files.

Image materials should be analyzed with a multimodal model, not OCR alone.

### Moments / social screenshot analysis

`/moments` analyzes screenshots or pasted social posts with multimodal vision:

- what the person is trying to show,
- appearance presentation, makeup, outfit, filters, visual style,
- comment/like/reply interaction style,
- likely conversation style,
- good topics,
- topics to avoid,
- how the user can show themselves without looking needy.
- micro-information such as MBTI/astrology attitude, catchphrases, gift preferences, food restrictions, and mood-specific wording.

Please anonymize real names, avatars, school/company names, locations, phone numbers, and other identifying details.

### Date planning side notes

When an invitation is sent or accepted, `/date-plan` separates:

- **Copyable replies**: only text safe to send.
- **User-only side notes**: booking, holidays, flowers/gifts, outfit, restaurant etiquette, pace, follow-up.

For example, 520/Qixi/weekend dinner reminders, flower choices, and Western restaurant ordering etiquette go in the side notes, not in the message to copy.

### Long-term local memory

Profiles live in local `partners/`:

- communication style,
- subtext dictionary,
- interest trend,
- Moments/social profile,
- appearance/makeup/outfit presentation,
- MBTI/astrology attitude, food restrictions, gift preferences, catchphrases,
- date preferences,
- effective and ineffective strategies,
- the user’s actual writing style.

`partners/` is ignored by git.

---

## Quick Start

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git
cd dianzi-junshi
```

### Claude Code

Open the project in Claude Code and run:

```text
/junshi
```

Then use:

```text
/reply What have you been up to lately?
/ask I want to say "are you ignoring me?"
/interest
/moments
/date-plan
```

### Codex

See [platforms/codex.md](platforms/codex.md).

Recommended install path:

```text
$HOME/.agents/skills/dianzi-junshi
```

Prompt example:

```text
Use $dianzi-junshi to analyze this chat and give me a low-oiliness flirty reply.
```

### ChatGPT

See [platforms/chatgpt-instructions.md](platforms/chatgpt-instructions.md).

To build a single knowledge file for a Custom GPT:

```bash
python tools/build_chatgpt_pack.py
```

Upload `dist/dianzi-junshi-chatgpt-pack.md`.

---

## Commands

```text
/junshi               Create a partner profile
/import-folder [path] Auto-classify chats, images, screenshots, notes
/reply [message]      Analyze and draft replies
/analyze [message]    Analyze only
/ask [idea]           Evaluate something you want to send
/interest             Judge whether they are interested
/anti-simp on/off     Toggle direct stop-loss mode
/moments              Analyze Moments/social screenshots
/date-plan            Date invitation replies and user-only notes
/upload-followup      Analyze follow-up chat and update memory
/stage [0-7]          Update relationship stage
/memory               View memory
/stats                Strategy stats
/update-partner       Update partner profile
/my-style             Update your style
/list-partners        List profiles
```

---

## Tools

```bash
python tools/wechat_parser.py --file chat_log.txt --target "name"
python tools/import_folder.py --path "C:\Users\me\Desktop\ta-materials"
python tools/profile_manager.py --action init --slug emily --name Emily --stage 1 --anti-simp
python tools/session_log.py --action stats --slug emily
python tools/skill_check.py
```

All tools use the Python standard library.

---

## Principles

- Keep the useful Chinese internet concepts: “oiliness”, “flirty version”, and “anti-simp mode”.
- Judge interest mainly from real chat evidence and human dating experience, not academic labels.
- Do not diagnose people or rely on gender stereotypes.
- Do not generate manipulative, coercive, deceptive, or privacy-invasive advice.

---

## License

MIT. See [LICENSE](LICENSE).
