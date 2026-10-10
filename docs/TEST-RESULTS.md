# Test results

Run on Windows 11 with Claude Code CLI 2.1.284 (installed) and the 2.1.293 engine that ships with the desktop app. Date of the last full run: 2026-10-09.

## Automated

| Check | Result |
| --- | --- |
| `npm run typecheck` (TypeScript 5.9, strict) | clean against the 2.1.284 and 2.1.293 types |
| `claude plugin validate .claude-plugin/plugin.json` | passed |
| `claude plugin validate .` (marketplace) | passed |
| `claude plugin test .` | **54 pass, 0 fail** |

What the 54 tests cover:

- **Smart Brain:** classification; routing in the three modes; manual model; blocked tiers; model ids coming from configuration; continuation; warm cache; learning from history; bounded escalation; subagent routing.
- **Token Intelligence:** API-equivalent cost from configured prices; estimated savings and tokens saved; usage distribution; models without a price are counted but never priced.
- **Guardians:** dangerous and ordinary commands; pushes to protected branches; secret detection and redaction; critical paths; git status parsing.
- **Auto QA:** script discovery; Windows command wrapping; project profiles.
- **Tasks:** verified milestones; the avatar following tool use; ETA from history with broader fallbacks; worked time, running time and time left; readable titles for notices, short replies and markup.
- **Inside the engine:** every `/bigbear` command tested; settings persisting across sessions; the Guardian denying a force push and letting `git status` through; `rm -rf /` blocked even in "warn only" mode; **a full turn routed** (prompt, `turn.start`, `turn.step` sent with the Haiku id, `turn.complete`, task COMPLETED); routing off keeping the session model; the notification on task completion (on and off); the pane, band, settings and showcase drawn on the **terminal and desktop** surfaces, including a narrow pane and a short pane that switches to the dense layout.

A real bug found by these tests and fixed: the default configuration object was mutated after being handed to the host's state, which freezes its values.

## In real Claude Code sessions

| Check | Result |
| --- | --- |
| Plugin recognized with `--plugin-dir` and after a user-scope install | `/bigbear status` answered |
| Loads in any folder with no flags | yes |
| `/bigbear doctor probe` | Haiku 5.5, Sonnet 5.5 and Opus 5.5 available on the test account |
| A real turn, session default Sonnet, simple question | served by `claude-haiku-5-5` (confirmed in the JSON `modelUsage`) |
| `/bigbear qa list` and `/bigbear qa <profile>` | scripts discovered and run for real; exit codes and durations reported |

## Not verified automatically

- Pixel-level appearance in the desktop app: checked by eye from screenshots during development, not by an automated test.
- The 5H and WEEK meters with live values need a subscription reading, which headless runs do not have; without it the band shows "N/D — indisponível", which is the intended behavior.
