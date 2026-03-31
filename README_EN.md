# 电子军师 (Digital Strategist)

<div align="center">

**Sometimes, you just need to say the right thing.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Claude_Code-blue)](https://claude.ai/code)
[![中文](https://img.shields.io/badge/中文-README.md-red)](README.md)
[![EN](https://img.shields.io/badge/English-README__EN.md-lightgrey)](README_EN.md)

</div>

---

You're in the middle of pursuing someone and don't know what to say.  
They sent you a message and you can't quite read it.  
You have something you want to say but aren't sure if you should.

**电子军师 (Digital Strategist)** is a full-journey relationship assistant running inside Claude Code.

From first conversation to long-term relationship — it helps you read the room, think clearly, and say what needs to be said.

---

## Core Features

### 1. Relationship Stage System

Different stages require completely different strategies.

| Stage | Name | Tone |
|-------|------|------|
| 0 | Just Met | Interesting, don't reveal interest |
| 1 | Flirting / Ambiguous | Subtle hints, let them guess |
| 2 | Actively Pursuing | Confident, strategic |
| 3 | Confessing / Confirming | Clear but not desperate |
| 4 | Early Relationship | Sweet but retain independence |
| 5 | Stable Relationship | Natural, maintain freshness |
| 6 | Friction / Bottleneck | De-escalate, find core issue |
| 7 | Crisis | Calm, composed, dignified |

### 2. Oil Level Control (Clinginess Control)

The biggest mistake in early stages: **exposing neediness**.

"Are you ignoring me lately?" — in the flirting stage, this can get you written off immediately.

The strategist controls the "oil level" (clinginess/intimacy level) of every reply based on your current stage:

- Just Met / Flirting: cap at 0–1.5/5 — subtle, interesting, unhurried
- Early Relationship: cap at 3.5/5 — sweet but not overwhelming
- Crisis stage: cap at 0.5/5 — calm, dignified

### 3. Three-Layer Message Analysis

Every message has three layers:

```
Layer 1  Surface meaning    What they literally said
Layer 2  Emotional state    What they're actually feeling right now
Layer 3  Real need          What they actually want from you
```

"Whatever, you decide" might mean "I want you to take charge."  
"It's fine, don't worry" might mean "I care a lot but I won't say it first."

### 4. Strategist Mode (军师模式)

You have something you want to send them — but you're not sure:

```
/ask I want to say "do you kind of like me?"
```

The strategist evaluates: can you say this? why? how to rephrase it? when's the right timing?

### 5. Auto-Feedback Analysis

After sending a reply, upload the follow-up chat log:

```
/upload-followup
```

The strategist analyzes their reaction, determines if the strategy worked, and records it for future accuracy.

### 6. Emotional Value Framework

The goal of a reply isn't just to respond — it's to make them feel something real:

| Emotional Value | Meaning |
|----------------|---------|
| Cherished | They feel important to you |
| Amused | They actually laughed |
| Understood | They feel truly seen |
| Attracted | Their heart skipped a beat |
| Reassured | Their anxiety faded |
| Surprised | They didn't expect you to say that |
| Admired | They think you're impressive |

---

## Quick Start

```bash
git clone https://github.com/shoal-rat/reply-skill.git
cd reply-skill
```

In Claude Code, run:

```
/zhunshi
```

Answer 6 questions (all skippable), build a profile, and start.

---

## Usage Examples

### Example 1: Flirting stage — she asks "What have you been up to lately?"

```
/reply What have you been up to lately?
```

**Three-layer reading**

```
Surface:   Asking about your life
Emotional: Mildly anxious / wanting connection · Intensity 2/5
Real need: To feel valued — she wants to know she matters in your life
```

**Reply options (Current stage: Flirting · Oil level cap 1.5/5)**

```
[Option 1] Humorous · Amused · Oil level 0.5/5
————
"Staying alive, you?"
————
Expected: She finds it a bit funny, keeps the conversation going
Fit: 8/10

[Option 2] Subtly warm · Cherished · Oil level 1/5
————
"Been a lot going on, but having people around helps"
————
Expected: She notices she might be included in "people", wants to keep talking
Fit: 9/10

[Option 3] Create curiosity · Surprised · Oil level 0.5/5
————
"Got some stuff going on, I'll tell you later — how about you?"
————
Expected: She's curious what you're up to, topic shifts to her
Fit: 7/10
```

💡 Recommend Option 2. In the flirting stage, hiding signals inside everyday language works better than saying it directly.

---

### Example 2: Strategist mode — want to ask "do you kind of like me?"

```
/ask I want to ask "do you kind of like me?"
```

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 Strategist Assessment

  You want to say: "do you kind of like me?"
  Current stage: Flirting (Stage 1)

Verdict: ❌ Not recommended

  Stage fit: 3/10
  Oil level: 3/5 (cap: 1.5/5)
  Neediness risk: High

  Risk: This turns an uncertain, building connection
  into a question that requires an immediate answer.
  If they're not ready, they can only say no —
  even if they actually have feelings.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💬 Better options

  [Option 1] Create a situation that lets them show it
  ————
  "You mentioned wanting to go to that place — free this weekend?"
  ————
  Why: Suggesting a meetup is more effective than asking directly.
  The dynamic stays in your favor.

  [Option 2] Hint instead of asking
  ————
  "You seem like you've been more talkative lately"
  ————
  Why: It's a factual observation. You leave them space to explain,
  giving them the opening to show their hand.

  [Option 3] Wait
  ————
  [Hold until they reach out first]
  ————
  Why: When they come to you, attraction is working.
  That's when you advance.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕐 Timing

  Not now: Relationship is still forming, early reveals lose leverage
  Best after a meetup: in-person context is stronger than text
```

---

### Example 3: Upload follow-up chat for automatic analysis

```
/upload-followup
[paste follow-up chat log]
```

```
📊 Effect Analysis

  You sent: "Been a lot going on, but having people around helps"
  Strategy: Option 2 (subtly warm)

  Their response: "people? which people, be more specific"
  Conversation continued: Yes, 5 more turns

  Outcome: Very good ✓

  Analysis: They picked up on the vague "people" and
  pushed to clarify — they noticed. Subtle signal
  strategy works well in the flirting stage. Recorded.
```

---

## Command Reference

```
/zhunshi              Create new profile
/reply [message]      Analyze and generate reply options
/ask [I want to say...] Strategist evaluates your idea
/analyze [message]    Analysis only, no replies
/upload-followup      Upload follow-up chat for effect analysis
/stage [0-7]          Update current relationship stage
/stats                View strategy effectiveness stats
/update-partner       Update partner profile
/my-style             Update your communication style
/list-partners        View all profiles
```

---

## Chat Log Import

```bash
python tools/wechat_parser.py \
  --file chat_log.txt \
  --target "their name" \
  --output partners/emily/materials/analysis.txt
```

Supported: WeChatMsg exported `.txt` / manually pasted chat (format: `Name: message`)

---

## Project Structure

```
reply-skill/ (电子军师)
├── SKILL.md                    # Skill entry point
├── prompts/
│   ├── intake.md               # Info collection (includes stage selection)
│   ├── stage_system.md         # 8-stage definitions and strategy rules
│   ├── oil_control.md          # Clinginess level control
│   ├── advisor_mode.md         # Strategist mode (evaluates your ideas)
│   ├── auto_feedback.md        # Automatic effect analysis
│   ├── partner_builder.md      # Partner profile template
│   ├── partner_analyzer.md     # Profile analysis rules
│   ├── message_analyzer.md     # Three-layer message analysis
│   ├── reply_generator.md      # Reply option generation
│   ├── style_calibrator.md     # User style calibration
│   └── correction_handler.md   # Correction and feedback handling
├── tools/
│   ├── wechat_parser.py        # Chat log parser
│   ├── profile_manager.py      # Profile management CLI
│   └── session_log.py          # Session logging and stats
├── partners/                   # Profile data (local, not committed)
└── docs/
```

---

## Notes

- **Privacy**: All data stays in the local `partners/` folder — nothing is uploaded to any server
- **Tool, not script**: The strategist helps you express yourself — the feelings have to be real
- **No manipulation**: All suggestions aim for genuine emotional connection, no coercive tactics
- **You're in charge**: These are options, not commands. You know your relationship best

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Pursuing someone isn't a game to be won.<br>
It's about finding the truest version of yourself<br>
and letting them see it.

</div>
