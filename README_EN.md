<div align="center">

# Dianzi Junshi

### A Chinese dating-chat agent for people who freeze up, overthink, or cannot read the room.

Paste a chat screenshot. It reads the situation, judges interest, drafts three replies, and switches into anti-Haiwang/Haihou push-pull mode when someone looks like a player.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/runs_in-Claude_Code-blue)](https://claude.ai/code)
[![Codex](https://img.shields.io/badge/runs_in-Codex-0F766E)](platforms/codex.md)
[![中文](https://img.shields.io/badge/中文-README-red)](README.md)

</div>

![Paste a screenshot, get three replies you can send](assets/demo-reply.svg)

> Want to jump straight in? See [Setup and first run](#setup-and-first-run). You paste a few commands once, then talk normally.

## Who It Helps

Use it when you are stuck on:

- Whether their reply actually means anything.
- How to flirt without sounding oily, needy, or too intense.
- Whether hot-and-cold behavior is normal push-pull or a player pattern.
- What to say once a date is possible.
- Remembering multiple people without mixing up their details.

The default playbook is simple: **show who you are first, flirt lightly, move forward when they catch the ball, pull back when they do not, and switch tactics when the other person looks like a Haiwang/Haihou.**

## Core Features

### 1. Reads the chat and gives sendable replies

It breaks the message into literal meaning, emotional state, and what they may actually want, then gives three versions: safe, flirty, and show-yourself. Each one includes an oiliness score for the current stage.

### 2. Judges whether they are into you

![Interest score with evidence, plus anti-simp stop-loss](assets/demo-interest.svg)

It does not collapse everything into one vague score. It splits interest into four dimensions: chat sweetness, initiative, relationship commitment, and meet-up/action follow-through. Initiating, remembering your details, catching your jokes, and agreeing to meet push the score up. Endless "haha," vague plans, and showing up only when they need help push it down. Anti-simp mode tells you when a thread is not worth more effort.

### 3. Anti-Haiwang/Haihou mode

![Anti-Haiwang/Haihou mode with confidence score, signals, and push-pull strategy](assets/demo-anti-player.svg)

It watches older patterns like hot-and-cold and all-flirt-no-plans, plus newer platform-native signals: template-perfect emotional value, flirty comment sections, Moments bait, multi-line scheduling, and holiday heat without concrete plans.

When the confidence score gets high, it changes the game:

- **Lower frequency**: stop feeding endless emotional value.
- **Push the ball back**: turn "someday" into time, place, and action.
- **Test another time slot**: check whether attention exists outside their usual maintenance window.
- **Check your details**: pretty words matter less if they remember nothing about you.
- **Ask for concrete plans**: real action gets more investment; vague warmth does not.

### 4. Different types need different plays

Direct, slow-burn, aesthetic/ritual, social butterfly, high-option player type: it reads the chat and Moments evidence, then picks a playbook and push-pull intensity. Pursuing men and pursuing women get calibrated against common social scripts, without forcing everything through gender.

It also models a layer of **personality baseline** underneath behavior: whether the other person responds more to an edgier, harder-to-read vibe or to a gentle, reassuring one, plus what they like, dislike, and treat as off-limits. Then, within a side of yourself you actually have, it dials up the channel they respond to — not a fake persona. See a line you like on a short video or in the comments and want to use it? Paste it in and it calibrates the line to the current stage, their vibe, and your oiliness cap so it sounds like you (it never copies any creator's wording verbatim).

### 5. Reads Moments and social screenshots

Moments feeds are mostly visual. It looks at makeup, outfit, filters, framing, comments, captions, stickers, and interaction patterns to infer openers, date ideas, gift hints, and what not to touch. Batch image imports get one structured record per image: who initiated, who caught the ball, whether there was a counter-question, whether there was an invite, and whether the signal cooled down.

### 6. Keeps date replies and private reminders apart

![Left column to send, right column for your eyes only](assets/demo-dateplan.svg)

The sendable reply stays separate from user-only reminders: when to book, whether to bring flowers, what to order, and how to follow up. That way you do not accidentally paste "remember to book the table."

The reminders also include an **in-person experience design**: building one or two moments that break the usual routine — built around what they already like or have hinted they want to try — so the date is more memorable. Read the room: lean in when they're enjoying it, change pace when they're not.

### 7. Remembers each person separately

![On open it asks who you're talking to; pick someone or start a new profile](assets/demo-switch.svg)

Each person gets a separate profile: stage, chat habits, what worked, Haiwang/Haihou confidence, Moments read, taboos, verbal habits, and sticker preferences. New windows can continue from the same file. Profile names are labels, not relationship facts; full reviews keep `analysis_vN.md` files with evidence, scores, and next steps.

## What The Output Looks Like

For a normal chat, it gives short replies:

```text
Safe: Just wrapped up a project, catching up on sleep these two days. You?
Flirty: Busy making life slightly more interesting, while waiting for an interesting person to ask.
Show-yourself: Went hiking this weekend. The view at the top was ridiculous. What do your weekends usually look like?
```

For push-pull, low interest, or player signals, it adds a strategy box away from the copyable reply:

```text
┌ Strategy
│ Reply interval: 1-4 hours
│ Pause advice: close this round
│ Push-pull move: push the ball back
│ Watch: whether they give a time/place or add details
│ Come back with: what you sent, when you sent it, how long they took, what they replied
└
```

## Setup And First Run

Pick the path that fits you.

![Install once, answer a few questions, send a screenshot](assets/workflow.svg)

### Path A - Claude Code

**Step 1, install Claude Code.**

- Windows: press `Win + X`, click "Terminal" or "Windows PowerShell", paste:

  ```powershell
  irm https://claude.ai/install.ps1 | iex
  ```

- Mac: open Terminal and paste:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

**Step 2, install Dianzi Junshi as a Skill.**

- Windows:

  ```powershell
  irm https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.ps1 | iex
  ```

- Mac:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/shoal-rat/dianzi-junshi/master/install.sh | bash
  ```

**Step 3, start talking.** Run `claude`, then say "help me with someone." It builds a profile and you drop in a WeChat screenshot or chat log.

### Path B - Codex

Clone it into the Codex skills folder:

```powershell
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME\.agents\skills\dianzi-junshi"
```

On Mac / Linux:

```bash
git clone https://github.com/shoal-rat/dianzi-junshi.git "$HOME/.agents/skills/dianzi-junshi"
```

More in [platforms/codex.md](platforms/codex.md).

## How To Talk To It

No commands required:

```text
(paste a screenshot) how should I reply to this
what does this mean, do I still have a shot
I want to send "are you ignoring me," should I
this feels like a Haihou, help me judge
they said yes to the weekend, help me plan it
new profile, there's someone else now
```

Commands like `/reply`, `/interest`, `/moments`, `/date-plan`, and `/anti-simp on` also work.

## Oiliness

Oiliness is not about banning sweetness or flirting. It asks: at this stage, would a stronger signal scare them off?

| Stage | Rough cap | Feel |
| --- | --- | --- |
| Just met / flirting | 0-1.5 / 5 | interesting, do not show your hand |
| Pursuing / confirming | 2-2.5 / 5 | active, but do not push for an answer |
| Early / stable | 3-3.5 / 5 | sweet is fine, do not loop |
| Friction / crisis | 0.5-1.5 / 5 | cool down first |

The Chinese UI keeps words like "油腻度", "会撩", "暧昧", "上头", and "别露底" because they are direct and useful in Chinese internet dating talk.

## How It Works

![From a screenshot to three replies, plus a memory loop that sharpens with use](assets/demo-how.svg)

1. **Read the scene**: load this person's profile, current time, stage, and recent context.
2. **Three layers**: what they said, what mood it carries, what they may want.
3. **Weigh it**: interest, tactics, oiliness, timing, and push-pull intensity.
4. **Hand you lines**: three sendable replies, then a human-voice pass.
5. **Write memory**: feedback updates what works for this person.

## FAQ

**I'm not technical. Can I still use this?**
Yes. Follow Path A and paste the lines one by one.

**A command errors out, or it says git is missing?**
On Windows, install [Git](https://git-scm.com/downloads/win), then redo the install step.

**It is installed but does not wake up.**
Fully quit Claude Code or Codex and open it again. Newly installed skills often load after restart.

**How do I switch people?**
Say "switch" or "new one." Each person has a separate profile.

## License

MIT. See [LICENSE](LICENSE).
