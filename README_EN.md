# reply-skill

<div align="center">

**Sometimes, you just need to say the right thing.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Claude_Code-blue)](https://claude.ai/code)
[![中文](https://img.shields.io/badge/中文-README.md-red)](README.md)
[![EN](https://img.shields.io/badge/English-README__EN.md-lightgrey)](README_EN.md)

</div>

---

Sometimes what's missing between you and your partner isn't love — it's the right reply.

reply-skill is a relationship reply assistant that runs inside Claude Code.  
It analyzes the real meaning behind your partner's messages and generates reply options that deliver genuine emotional value — written in *your* voice, not an AI's.

---

## Core Features

### Three-Layer Message Analysis

Every message carries three layers of meaning:

```
Layer 1 · Surface meaning    What they literally said
Layer 2 · Emotional state    How they're actually feeling
Layer 3 · Real need          What they're truly looking for
```

"Whatever, I don't care what we eat" might really mean "I want you to take charge."  
"It's fine, don't worry about me" might really mean "I care a lot but I won't say it first."  
reply-skill helps you see through to what matters.

### Emotional Value-Driven Replies

The goal of a reply isn't just to respond — it's to make your partner feel something:

| Emotional Value | Description |
|----------------|-------------|
| Cherished | They feel like they matter to you |
| Amused | They genuinely laugh |
| Understood | They feel truly seen |
| Attracted | They feel a spark |
| Reassured | Their anxiety fades |
| Surprised | You said something they didn't expect |
| Admired | They think you're impressive |

Each reply option shows which emotional value it delivers and what reaction to expect.

### Partner Profile System

Your partner has unique speech habits, emotional patterns, and subtext tendencies.  
reply-skill builds a dedicated profile for them that gets more accurate over time:

- Speech style analysis (message density, punctuation habits, favorite filler words)
- Emotional needs map (love languages, being-seen needs, anxiety triggers)
- Behavior pattern recognition (how they act when happy / sad / clingy / angry)
- **Subtext dictionary** (their specific phrases and what they actually mean)

### User Style Calibration

Generated replies are aligned to *your* communication style —  
if you're a person of few words, you won't get verbose suggestions. If you like playful banter, you'll see that.

---

## Quick Start

### Installation

```bash
# Clone the project
git clone https://github.com/shoal-rat/reply-skill.git
cd reply-skill

# Register SKILL.md with Claude Code
# In Claude Code, run:
```

```
/reply-love
```

### First Use

Run `/reply-love` and the system guides you through 5 questions:

```
Q1: What should we call your partner? (a nickname is fine)
Q2: Basic relationship info
Q3: Their personality traits
Q4: How do you usually reply to messages?
Q5: Do you have chat logs to import? (optional)
```

5 minutes to build a profile. Every reply after that gets more accurate.

---

## Usage Examples

### Example 1: She asks "What have you been up to lately?"

```
/reply What have you been up to lately?
```

**Message Reading**

```
Surface:    Asking about your recent life
Emotional:  Mildly anxious / seeking connection · Intensity 2/5
Real need:  To feel valued — she wants to know she has a place in your life
```

**Reply Options**

```
[Option 1] Warm · Emotional value: Cherished
————
"Busy, yeah — but not too busy to miss you"
————
Expected reaction: She'll feel you have her in mind, probably sends a blushing emoji
Fit score: 9/10

[Option 2] Playful · Emotional value: Attracted
————
"Busy thinking about you. Any complaints?"
————
Expected reaction: She'll roll her eyes but smile, keeps the conversation going
Fit score: 8/10

[Option 3] Genuine · Emotional value: Understood
————
"Honestly the project's been stressful, but talking to you always helps. How are you doing?"
————
Expected reaction: She'll feel needed, opens up more
Fit score: 7/10
```

---

### Example 2: He says "I'm fine, I'm not tired" (but clearly is)

```
/reply I'm fine, I'm not tired (he sounds heavy, said he had to work overtime)
```

**Message Reading**

```
Surface:    Says he's not tired
Emotional:  Exhausted + mildly sulky · Intensity 3/5
Real need:  To be cared for — he says he's fine but wants you to see through it
```

Subtext alert: Profile records "I'm fine" = something's wrong but he won't say it first

**Reply Options**

```
[Option 1] Warm · Emotional value: Cared for
————
"I don't believe you. Tell me when you're done — I'll be here"
————
Expected reaction: He'll feel seen, his tone will soften
Fit score: 9/10
```

---

### Example 3: She suddenly asks "Do you think we're right for each other?"

```
/analyze Do you think we're right for each other?
```

**Message Reading**

```
[Surface Meaning]
Asking your opinion on the compatibility of your relationship

[Emotional State]
Anxious / uncertain, Intensity: 4/5
Likely experiencing relationship insecurity right now

[Real Need]
Reassurance — she's not doing math, she needs to hear "we're okay"

[Message Type] Test · [Risk Level] Needs attention

⚠️ Subtext note: This type of question is usually an emotional outlet,
   not a rational discussion. Soothe the emotion first, then state your position.
```

---

## Profile Management

```bash
# View all profiles
/list-partners

# Switch to a profile
/partner emily

# Update partner profile
/update-partner

# Update your reply style
/my-style
```

---

## Chat Log Import

Import chat logs for more accurate analysis:

```bash
# Process WeChatMsg exported txt file
python tools/wechat_parser.py \
  --file chat_log.txt \
  --target "her name" \
  --output partners/emily/materials/analysis.txt
```

Supported formats:
- WeChatMsg exported `.txt` files
- Manually pasted chat logs (format: `Name: message content`)

---

## Feedback System

After sending a reply, tell the system how it went:

```
"Sent option 1, she replied right away and seemed happy"  → Strategy logged as effective
"Sent it and he went quiet"                               → Logged, adjusted next time
"This suggestion is off — he wouldn't say that"          → Profile updated immediately
```

The more you use it, the better it knows your partner.

---

## Project Structure

```
reply-skill/
├── SKILL.md                    # Skill entry point
├── prompts/
│   ├── intake.md               # Information collection flow
│   ├── partner_builder.md      # Partner profile template
│   ├── partner_analyzer.md     # Profile analysis rules
│   ├── message_analyzer.md     # Three-layer message analysis
│   ├── reply_generator.md      # Reply option generation
│   ├── style_calibrator.md     # User style calibration
│   └── correction_handler.md   # Correction and feedback handling
├── tools/
│   ├── wechat_parser.py        # Chat log parsing tool
│   ├── profile_manager.py      # Profile management CLI
│   └── session_log.py          # Session logging tool
├── partners/                   # Profile data (local, not committed)
│   └── {slug}/
│       ├── meta.json
│       ├── profile.md
│       ├── history/
│       ├── versions/
│       └── materials/
└── docs/
```

---

## Notes

- **Privacy**: All profile data is stored locally and never sent to any server
- **Reality**: This tool helps you find the right expression — it can't replace real feelings
- **Boundaries**: No manipulative or coercive reply suggestions will be generated
- **Judgment**: All options are suggestions. You know your relationship best

---

## License

MIT License — see [LICENSE](LICENSE)

---

<div align="center">

A good reply isn't about getting them to do something.<br>
It's about making them feel that you genuinely care.

</div>
