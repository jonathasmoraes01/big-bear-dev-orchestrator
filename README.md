<div align="center">

<img src="assets/readme/banner.png" alt="BIG BEAR DEV ORCHESTRATOR: Code Smarter. Build Faster. Spend Less." width="100%">

<br>

[![License: MIT](https://img.shields.io/badge/license-MIT-10B981?style=flat-square)](LICENSE)
[![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-38BDF8?style=flat-square)](#install)
[![Tests](https://img.shields.io/badge/tests-54%20passing-10B981?style=flat-square)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-A855F7?style=flat-square)](#development)
[![Telemetry: none](https://img.shields.io/badge/telemetry-none-94A3B8?style=flat-square)](#privacy-and-safety)

**Pick the right Claude model for every request. See every task, token and limit in one pane. Spend less.**

[Install](#install) · [Features](#features) · [Commands](#commands) · [How routing works](#how-routing-works) · [Português](README.pt-BR.md)

</div>

---

## What is it?

**BIG BEAR DEV ORCHESTRATOR** is a mod for [Claude Code](https://claude.com/claude-code). It sits beside your session and does five jobs:

1. **Routes** each request to Haiku, Sonnet or Opus, using free local rules (no extra model calls).
2. **Tracks** every task and subagent in a live side pane, with real states, timers and ETAs.
3. **Measures** tokens, API-equivalent cost and estimated savings, per model.
4. **Watches** your 5-hour and weekly usage windows, straight from Claude Code's own numbers.
5. **Guards** your repo: dangerous commands, secrets, critical files, git state, and real test runs.

It is one plugin with independent modules. Turn any of them off; the rest keep working.

<div align="center">

| Idle | Researching | Working |
| :---: | :---: | :---: |
| <img src="assets/readme/bear-idle.png" width="150" alt="Big Bear, idle"> | <img src="assets/readme/bear-research.png" width="150" alt="Big Bear, researching"> | <img src="assets/readme/bear-work.png" width="150" alt="Big Bear, working"> |

The pane header changes with what the agent is doing: reading and searching, or changing things.

</div>

## The panel

```text
╭──────────────────────────────────────────────────────────╮
│ [bear]  BIG BEAR  DEV                     ● Working      │
│         my-project  ⎇ main                               │
│         [ BALANCED ] [ SONNET · THE BUILDER ]            │
╰──────────────────────────────────────────────────────────╯
▍TASKS ─────────────────────────────────────────── 4/6 · 67%
 [ 1 RUNNING ] [ 3 DONE ]
 [ WORKING FOR 2m31s ] [ WORKED 14m08s ] [ LEFT ~3m40s ]

 ▌● S  Fix · Mammonite damage on miss     ▰▰▰▱▱  2m31s  ETA ~1m50s
 ✓ H  Search · where is calcularDano?     ▰▰▰▰▰  38s    9k tok
 ✓ O  Audit · race condition in drops     ▰▰▰▰▰  6m02s  212k tok
▍TOKEN INTELLIGENCE ───────────────────────────────────────
 ╭ TOKENS ───────────╮ ╭ API EQUIVALENT ───╮
 │ session   1.24M   │ │ total      $4.18  │
 ╰───────────────────╯ ╰───────────────────╯
 ╭ SMART SAVINGS ────╮ ╭ MODEL USAGE ──────╮
 │ est.      −38%    │ │ HAIKU   ██░░░ 24% │
 │ tokens    ~470k   │ │ SONNET  █████ 61% │
 ╰───────────────────╯ ╰───────────────────╯
▍GUARDIANS ────────────────────────────────────────────────
 ● Git 13 changes     ● QA passed
 ● Security clear     ● Context 34%
```

Above your prompt there is also a one-line status band: mode, active model, **5H** and **WEEK** meters, reset time and context fill.

The pane fits the height of your window: with room it shows full cards, without it switches to a dense layout. It never needs a scrollbar.

## Features

| Module | What it really does |
| --- | --- |
| **Smart Brain** | Classifies the prompt with local rules and rewrites the model of each request at `turn.step`. Haiku reads and searches, Sonnet builds, Opus plans and audits. Keeps the model steady through a turn, avoids switching while the prompt cache is warm, escalates one tier (at most once per turn) when tools keep failing, and learns from your history. |
| **Intelligence modes** | **ECO** (cheapest that works), **BALANCED** (default), **GOD** (most capable where it matters; it is *not* "Opus for everything"). |
| **Task Command** | Live pane: every task with status, a verified 5-step progress bar, elapsed time, ETA from history, tokens, errors, and a tree of the subagents that actually exist. |
| **Token Intelligence** | Input, output, cache read and cache write tokens per task and per session; API-equivalent cost from editable prices; estimated savings vs. a reference model; usage per model. |
| **Usage Monitor** | 5-hour and weekly windows with reset time, read from `$.session.usage()`. Alerts at 70, 85 and 95 %. Never guesses a weekly figure from session tokens. |
| **Code Guardian** | Asks before force push, branch deletion, `reset --hard`, `rm -rf`, `DROP TABLE`, production deploys. Blocks irreversible disk operations. Flags secrets being written and critical files being changed. |
| **Git Guardian** | Branch, ahead/behind, changes, conflicts, merge state, last commit. Warns on pushes to protected branches and commits with failing QA. |
| **Auto QA** | Finds `typecheck`, `lint`, `test` and `build` in your `package.json` and runs them for real. Project profiles included. |
| **Bug Hunter** | `/bigbear bug <error>`: a guided investigation that starts on Sonnet and escalates to Opus for architectural causes. |
| **Context Manager** | Warns as the context window fills. Never compacts on its own. Keeps technical decisions you record. |
| **Dev Analytics** | Local history: success rate by task type, average time, model mix, cost. Feeds the ETA and the routing. |
| **Showcase** | A clean panel for screenshots, plus a text summary with paths and secrets stripped. |

Also: a **notification** when each task finishes, **readable task titles** (a kind plus a clean summary, never raw markup), and a full **settings panel**.

## Install

> **Heads up:** Claude Code mods are an early-access feature. Tested on Claude Code **2.1.284** and **2.1.293**. The API may change between releases.

**1. Turn on function hooks.** Add this to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  }
}
```

**2. Add the marketplace and install** (user scope, so it loads in every project):

```bash
claude plugin marketplace add jonathasmoraes01/big-bear-dev-orchestrator
```

```bash
claude plugin install big-bear@big-bear-dev --scope user
```

**3. Start a new session.** The pane opens by itself and the usage band appears above the prompt. Check everything with:

```text
/bigbear doctor
```

To confirm which models your account can use: `/bigbear doctor probe` (one tiny call per model).

**Update:** `claude plugin update big-bear@big-bear-dev`, then `/reload-plugins`.
**Uninstall:** `claude plugin uninstall big-bear@big-bear-dev --scope user`.

Works in the Claude Code CLI, the VS Code integrated terminal and the **Claude desktop app (Code tab)**. In the VS Code extension chat the pane is not shown (the host does not draw mod panes there); the `/bigbear` commands still work as text.

## Commands

| Command | Effect |
| --- | --- |
| `/bigbear` | Open or close the pane |
| `/bigbear status` | Overall state |
| `/bigbear mode eco\|balanced\|god` | Switch mode (add `--project` to keep it for this project only) |
| `/bigbear model auto\|haiku\|sonnet\|opus` | Pin a model, or go back to automatic |
| `/bigbear block <tier>` · `unblock <tier>` | Forbid or allow a model |
| `/bigbear off` · `on` | Turn routing off or on. Off means stock Claude Code behavior |
| `/bigbear tasks` · `usage` · `models` · `history` · `summary` | Inspect |
| `/bigbear qa [profile\|list]` | Run your project's real checks |
| `/bigbear bug <error>` | Bug Hunter |
| `/bigbear decision <text>` | Record a technical decision |
| `/bigbear settings` | Settings panel |
| `/bigbear showcase [export]` | Screenshot panel / shareable text summary |
| `/bigbear doctor [probe]` | Diagnose your install |
| `/bigbear set-model <tier> <id>` | Change the model id behind a tier |
| `/bigbear alerts 70 85 95` | Usage alert thresholds |
| `/bigbear price <tier> <in> <out> <read> <write>` | Update prices (USD per million tokens) |
| `/bigbear reset` · `project reset` | Restore defaults |

In the pane: `1` ECO, `2` BALANCED, `3` GOD, `a` auto on/off, `s` settings, `w` showcase (focus the pane first with `ctrl+x` `tab`).

## How routing works

```text
prompt ─▶ local classifier ─▶ mode policy ─▶ guardrails ─▶ model for this request
          (no model call)     ECO/BAL/GOD     blocked tiers,
                                              manual pin,
                                              warm cache,
                                              failure history
```

| | 🟢 HAIKU · Scout | 🔵 SONNET · Builder | 🟣 OPUS · Architect |
| --- | --- | --- | --- |
| **ECO** | search, read, docs, small edits | features, bugs, tests | only critical and complex |
| **BALANCED** | search, read, simple edits | features, bugs, refactors, tests | architecture, audits, critical |
| **GOD** | trivial chat | simple builds | anything complex or risky |

- The model id for each tier is **configurable**. The defaults are `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5`; BIG BEAR never invents ids. Use `/bigbear doctor probe` to check them against your account.
- Switching models rebuilds the prompt cache. BIG BEAR avoids a switch while the cache is warm and the conversation is large, and limits mid-turn escalation to once per turn.
- An optional AI classifier exists for low-confidence prompts. It is **off by default** because it costs a call.

## Honest numbers

BIG BEAR does not make up metrics.

- **API equivalent** is what the same tokens would cost at API list prices. It is **not** what your subscription bills.
- **Smart Savings** compares that cost with a reference model (Sonnet by default, configurable) for the same tokens. It is an **estimate**. Routing makes a request cheaper, not smaller, so "tokens saved" means the saved share of the reference bill expressed in tokens. It is not a refund and not a guarantee about your weekly limit.
- **5H and WEEK** come only from Claude Code's reported rate-limit windows. When there is no reading you see `N/D — indisponível`.
- **ETA** comes only from finished tasks in your history. Until there is enough of it, the pane says "calculando".
- A task is **COMPLETED** only when the engine reports the turn ended with an answer (and, if Auto QA is on, QA passed).
- Default prices come from the Anthropic model table bundled with Claude Code (checked 2026-10-06). Cache write and Haiku cache read prices are derived with the standard multipliers. Edit them any time with `/bigbear price`.

> The interface text is currently in Portuguese (pt-BR), the author's language. The commands, settings and docs are in English.

## Privacy and safety

- **Nothing leaves your machine.** No telemetry, no external servers, no network calls of its own.
- History keeps metrics only (category, model, duration, tokens, cost). Never code, prompts or credentials. Task titles and QA output pass through a secret filter.
- The Code Guardian never approves anything for you: "Allow" only lets a command continue to Claude Code's normal permission check. It never bypasses approvals or other plugins' hooks.
- Turn routing off and Claude Code behaves exactly as before.
- A failing module is skipped by the engine; the rest keep running.

## Project profiles

Auto QA reads your `package.json` (`typecheck`, `lint`, `test`, `build`) and offers the profiles `quick`, `standard` and `full`. A profile for the author's own game project, **Ragnarok Classic Idle** (combat, idle bot, party, frontend), ships as an example of a per-project profile: see [`hooks/src/config/project-profiles/ragnarok.ts`](hooks/src/config/project-profiles/ragnarok.ts). Add yours next to it.

## Architecture

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: `hooks/register.tsx` is the only layer that captures events and holds the engine handle (`$`); every module receives a small `Io` object and keeps its rules in pure, tested functions.

```text
hooks/register.tsx        events, state, wiring
hooks/src/core/           classifier · router · tasks · orchestrator · titles
hooks/src/modules/        guardian · git · qa · monitor
hooks/src/services/       pricing · analytics · persistence · io
hooks/src/ui/             pane · band · settings · showcase · avatar
types/index.d.ts          state contract
tests/                    unit + in-engine integration
```

## Development

```bash
git clone https://github.com/jonathasmoraes01/big-bear-dev-orchestrator
cd big-bear-dev-orchestrator
npm install
```

```bash
npm run typecheck
```

```bash
claude plugin validate .claude-plugin/plugin.json
```

```bash
claude plugin test .
```

Run a local copy in a session: `claude --plugin-dir .` (with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`). Rebuild the pixel-art avatars with `python tools/build-avatars.py` and this banner with `python tools/build-banner.py` (needs Pillow).

Test results and what was verified in real sessions: [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md).

## Known limitations

- Early-access API; needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- While routing is on, BIG BEAR's choice replaces `/model` for each request. Use `/bigbear off` or `/bigbear model <tier>` to take control back.
- 5H and WEEK need a subscription and appear after the first response of a session.
- `WAITING` means a tool is running; the mod cannot see whether a tool waits for your approval.
- There is no official API to capture the interface as an image, so Showcase is for manual screenshots; `export` produces text.
- The pane width and docking are decided by Claude Code.

## Contributing

Issues and pull requests are welcome. Please run the three commands under [Development](#development) before opening a PR, and keep new rules in pure functions with a test. Model ids, prices and the Guardian rules are the places most likely to need updates as Claude Code and the models evolve.

## License

[MIT](LICENSE) © 2026 jonathasmoraes01. The bear artwork in `assets/` is included for use with this project.

<div align="center">

**🐻 Code Smarter. Build Faster. Spend Less.**

</div>
