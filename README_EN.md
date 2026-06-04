<div align="center">

# Dianzi Junshi

### Paste a chat screenshot, get three replies you can send right now.

For people who freeze up, who worry about saying the wrong thing, who can't read what the other person actually means.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/runs_in-Claude_Code-blue)](https://claude.ai/code)
[![Codex](https://img.shields.io/badge/runs_in-Codex-0F766E)](platforms/codex.md)
[![中文](https://img.shields.io/badge/中文-README-red)](README.md)

</div>

![Paste a screenshot, get three replies you can send](assets/demo-reply.svg)

> Want to jump straight in? See [Setup and first run](#setup-and-first-run) and paste one line at a time. No coding needed. Below is what it does first.

---

The hard part of chasing someone usually isn't the words.

It's not knowing whether that reply means anything, whether to flirt back or pull away, whether the line you want to send will scare them off. Their Moments feed, the restaurant, the flowers once they say yes. Each is its own puzzle.

Dianzi Junshi handles that. It reads your Chinese chats, tells you what they mean and whether they're into you, then hands you a few short replies that sound like a person instead of a script.

The approach is stubborn and simple:

> Show who you are first, then flirt lightly.
> They catch it, move forward. They don't, stop pushing. Clearly no, leave cleanly.

## Contents

- [What it does](#what-it-does)
- [Oiliness](#oiliness)
- [How it plays](#how-it-plays)
- [Setup and first run](#setup-and-first-run)
- [FAQ](#faq)
- [How it works](#how-it-works)

## What it does

**Reads the chat, gives you three replies**

It breaks down what they literally said, the feeling under it, and what they actually want, then gives three versions: safe, flirty, show-yourself. Each one carries an oiliness score (how sweet this stage can take), and anything over the line gets pulled back down for you.

**Whether they're actually into you**

![Interest score with evidence, plus anti-simp stop-loss](assets/demo-interest.svg)

Starting conversations, remembering what you said, catching your jokes, agreeing to meet: points up. Endless "haha," dodged plans, showing up only when they need a favor: points down. Turn on anti-simp mode and when a thread clearly isn't worth more effort, it tells you to stop rather than cheer you on.

**Different types need different plays**

Direct, slow-burn, aesthetic/ritual, social butterfly, high-option player type: it reads the chat and Moments evidence, then picks a playbook and a push-pull intensity. Pursuing men and pursuing women get calibrated against common social scripts, without forcing everything through gender.

**Spot their games the moment they start**

![It flags dangling promises and hot-and-cold games, with a no-bite reply and a take-back-control move](assets/demo-tactics.svg)

Hot and cold, dangling maybes, all flirt and no plans, playing hard to get: it knows these, tells you whether it's a game or just normal push-pull, then hands you a move that holds. It also watches newer platform-native signals: template-perfect emotional value, flirty comment sections, Moments bait, multi-line scheduling, and holiday heat without plans. When push-pull is the right call, it adds a strategy box: when to reply, whether to pause, what feedback to watch, and a Haiwang/Haihou confidence score.

**Once you have a date, replies and reminders stay apart**

![Left column to send, right column for your eyes only](assets/demo-dateplan.svg)

The left column is text you can send as-is. The right is for your eyes only: when to book, whether to bring flowers, how to order, when it's fine to float a next time. Kept apart so you never paste "remember to book the table" by accident. It also watches the clock and the calendar: your anniversaries and birthdays, plus 520, Qixi, and Valentine's, counted down so it reminds you to book and shop before they sneak up.

**Chasing more than one? Each stays separate.**

![On open it asks who you're talking to; pick someone or start a new profile](assets/demo-switch.svg)

You're not stuck with one person. Everyone gets their own profile (stage, chat habits, what actually works), all kept apart. Each time you open it, it asks who you're on about and lets you pick or start a new one, so it never mixes up one person's notes with another's.

**And along the way**

- **Reads Moments**: drop in screenshots; it looks straight at the makeup, outfit, filters, and comment threads to find openers. Half of a Moments feed lives in the pictures, and it reads the pictures, not just the text.
- **Remembers across windows**: it keeps what you've told it and corrected, and gets sharper with use. A new window picks up where you left off, no re-explaining.
- **Sorts a folder for you**: chat logs, screenshots, selfies, your own notes; point it at a folder and it sorts them, no prep on your end.

## Oiliness

Not about banning sweetness or flirting. It's a reminder: at this stage, would too strong a signal scare them off?

| Stage | Rough cap | Feel |
| --- | --- | --- |
| Just met / flirting | 0–1.5 / 5 | interesting, don't show your hand |
| Pursuing / confirming | 2–2.5 / 5 | be active, don't push for an answer |
| Early / stable | 3–3.5 / 5 | sweet is fine, don't loop |
| Friction / crisis | 0.5–1.5 / 5 | cool down first |

## How it plays

It helps you show your best self, say things clearly, and keep your pacing: lean in when it's time, pull back when it's time, and stay a step ahead of whatever the other person is playing. You're the lead; it's only the advisor.

## Setup and first run

Never used something like this? That's fine. Pick the path that fits you.

![Install once, answer a few questions, send a screenshot](assets/workflow.svg)

### Path A - Claude Code (install as a Skill; recommended, remembers everyone)

**Step 1, install Claude Code.** It's an AI tool that understands plain language and can read the screenshots on your computer.

- Windows: press `Win + X`, click "Terminal" (older systems: "Windows PowerShell"), paste this and hit Enter:

  ```powershell
  irm https://claude.ai/install.ps1 | iex
  ```

- Mac: press `Command + Space`, type "Terminal", hit Enter, then paste:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

  When it finishes, sign in with a Claude account (free to create one).

**Step 2, install Dianzi Junshi as a Claude Skill.** In the same window, paste one more line; it lands in `~/.claude/skills/dianzi-junshi`:

- Windows:

  ```powershell
  irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex
  ```

- Mac:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash
  ```

**Step 3, start talking.** Type `claude` and hit Enter, then type "help me with someone." It asks a couple of quick questions, builds a profile, and then you drop in a WeChat screenshot or chat log and it replies.

### Path B - Codex

On Codex, one command clones it into the Codex skills folder:

```powershell
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME\.agents\skills\dianzi-junshi"
```

(On Mac / Linux use `$HOME/.agents/skills/dianzi-junshi`.) More in [platforms/codex.md](platforms/codex.md).

### Once it's set up, just talk to it

No commands to memorize, just type normally:

```text
(paste a screenshot) how should I reply to this
what does this mean, do I still have a shot
I want to send "are you ignoring me," should I
they said yes to the weekend, help me plan it
new profile, there's someone else now
```

If you like commands, `/reply`, `/interest`, `/moments`, and `/date-plan` all work too. You just don't need them.

## FAQ

**I'm not technical and have never used a terminal. Can I still use this?**
Yes. Follow Path A and paste the lines one at a time; they're all written out for you, no coding needed.

**A command errors out, or it says git is missing?**
On Windows, install [Git](https://git-scm.com/downloads/win) (just click through), then redo step 2.

**It's installed but doesn't recognize the skill, or ignores me?**
Fully quit Claude Code (or Codex) and open it again; a newly installed skill loads on restart. Then say "help me with someone." If it still doesn't wake up, type `/dianzi-junshi` in Claude Code and hit Enter to call it directly.

**How do I switch people, or chase a few at once?**
Just say "switch" or "new one." It lists the people you've set up and you pick. Each gets their own profile, and they never get mixed up.

## How it works

It doesn't just hand your message to an AI and let it wing a line. Every time, it runs the same pipeline:

![From a screenshot to three replies, plus a memory loop that sharpens with use](assets/demo-how.svg)

1. **Read the scene**: pull up this person's profile, check the time, and lift out what was actually said before inferring anything.
2. **Three layers**: what they said, the feeling under it, what they actually want.
3. **Weigh it**: are they into you, is this a tactic, how sweet can this stage take.
4. **Hand you lines**: three ready-to-send replies, then one more pass for "does this sound like a real person" to strip the filler.

Every time you send, give feedback, or correct it, it writes that back to the person's profile, so it sharpens with use and remembers across windows.

## License

MIT. See [LICENSE](LICENSE).
