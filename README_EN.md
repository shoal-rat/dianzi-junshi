# Dianzi Junshi

<div align="center">

**A Chinese dating-chat strategist: show yourself first, flirt lightly, stop chasing when the signs are bad.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/platform-Claude_Code-blue)](https://claude.ai/code)
[![Codex](https://img.shields.io/badge/platform-Codex-0F766E)](platforms/codex.md)
[![ChatGPT](https://img.shields.io/badge/platform-ChatGPT-10A37F)](platforms/chatgpt-instructions.md)
[![中文](https://img.shields.io/badge/中文-README.md-red)](README.md)

</div>

---

Dating is messy in the small places.

Did they reply because they care, or because they are polite? Should you flirt back, ask them out, or stop trying so hard? What does their Moments feed say about their taste? If they said yes to meeting, do you need flowers, a booking, a gift, a better line?

Dianzi Junshi helps with that.

It reads Chinese chats, checks whether the other person is actually investing, and gives short replies that can be sent without turning the conversation into a speech.

The rule is simple:

> Show yourself first.
> Flirt lightly.
> If they catch it, move forward.
> If they do not, cool down.
> If the signs are clearly bad, leave cleanly.

## Commands

`/reply`
Reads a message and gives three versions: safe, flirty, and self-display / sincere / cool-down.

`/interest`
Scores whether they are interested. Questions, details, remembering things, accepting dates, and catching jokes count. Empty politeness and repeated rejection without an alternative do not.

`/anti-simp on`
Direct stop-loss mode. If the pattern is bad, it says so.

`/moments`
Looks at Moments or social screenshots with vision: makeup, outfit, filters, places, comments, captions, and interaction style.

`/import-folder path`
Point it at a folder. It sorts chats, screenshots, photos, and notes for you.

`/date-plan`
For invitations and accepted dates. It separates text you can copy from side notes only you should see: booking, flowers, gifts, timing, etiquette, and follow-up.

## Oiliness

“油腻度” means how much intimacy pressure a line carries.

| Stage | Rough cap | Feel |
| --- | --- | --- |
| Just met / flirting | 0-1.5/5 | signal, but do not reveal everything |
| Pursuing / confirming | 2-2.5/5 | be active, do not force an answer |
| Early / stable relationship | 3-3.5/5 | sweet is fine, repetitive sugar is not |
| Friction / crisis | 0.5-1.5/5 | cool down first |

## Start

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git
cd dianzi-junshi
```

Open the project in Claude Code and run:

```text
/junshi
```

Codex setup: [platforms/codex.md](platforms/codex.md)
ChatGPT setup: [platforms/chatgpt-instructions.md](platforms/chatgpt-instructions.md)

## Folder import

```text
/import-folder C:\Users\me\Desktop\ta-materials
```

It sorts:

- chat logs
- Moments / social screenshots
- selfie, outfit, makeup, avatar images
- notes
- unknown files

Image-heavy material needs an environment that can look at images. Text alone misses too much.

## Local profiles

Profiles live in `partners/` and are not committed by default.

They remember:

- chat habits and subtext
- interest trend
- Moments/social presentation
- makeup, outfit, taste, catchphrases
- MBTI / astrology attitude, food restrictions, gift preferences
- what worked and what went cold
- how you actually talk

## Tools

```bash
python tools/wechat_parser.py --file chat_log.txt --target "name"
python tools/import_folder.py --path "C:\Users\me\Desktop\ta-materials"
python tools/profile_manager.py --action init --slug emily --name Emily --stage 1 --anti-simp
python tools/session_log.py --action stats --slug emily
python tools/skill_check.py
```

## Boundaries

No PUA, stalking, coercion, cold-violence scripts, lying, jealousy bait, or privacy probing.

The strategist helps you say things cleanly. It does not replace your judgment.

## License

MIT. See [LICENSE](LICENSE).
