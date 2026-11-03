# AI workflow — how sessions work on Clanfire

Standing rules for every AI session (Claude Code locally or in Claude cloud, or any other
assistant). `AGENTS.md` links here. They come from the owner, so don't ask them to repeat them.

## 1. Start of every session

1. Read `docs/HANDOFF.md`, then the top of `CHANGELOG.md` (last ~2 weeks).
2. `grep` `NEXT_STEPS.md` for the topic you're on.
3. Work only in this repo. A cloud session should be started with **only** `34apps/tribewars`
   selected; if other repos are attached, ignore them.

## 2. The main session orchestrates; cheaper agents do the hands-on work

The main session plans, splits work, makes the judgment calls, reviews agent output and talks to
the owner. It does not grind through code itself. Pick the cheapest model that can do the job;
run independent pieces **at the same time** (several Agent calls in one message).

| Work | Agent (`.claude/agents/`) | Model |
|---|---|---|
| Run `npm run check` / build / tests / audit, read CI or server logs | `runner` | haiku |
| Find code, grep docs, git history, summarise a long file | `scout` | haiku |
| Mechanical edits: renames, copy/text changes, data tables, moving files | `editor` | haiku |
| Implement a feature with a clear spec, write tests, debug a failing test/build, UI screens | `implementer` | sonnet |
| Architecture, game rules and balance, API contract, security, a subtle bug, reviewing agents' work | main session | (strongest) |

If the project agents aren't loaded (e.g. a session started from another repo), use the
general-purpose agent and pass `model: "haiku"` or `model: "sonnet"` explicitly.

How to brief an agent: goal, exact files/folders, the contract it must follow (link
`docs/GAME_DESIGN.md`, `packages/engine/src/api.ts`), what's ruled out, what to report (short
conclusion, no file dumps). Never let two agents edit the same files at the same time — split by
folder (e.g. `apps/server` vs `apps/web`). Verify what an agent reports (read the diff, rerun
the checks) before telling the owner it's done.

## 2b. Cost rules (owner pays per use: Console / API billing)

- Main session: Opus 5.5 at **medium** effort (`/effort medium`); high only for big design/architecture
  decisions, then back to medium. Keep the main session's own reading and writing small — delegate.
- Default delegation: `runner`/`scout`/`editor` (haiku) for checks, lookups, mechanical edits;
  `implementer` (sonnet) for building. Use opus agents **only** for art/design work, and run **one**
  opus design agent at a time (no parallel art batches) unless the owner asks for speed.
- Don't re-read big files or dump long logs into the main context; ask agents for short reports.
- Before a big multi-agent job, tell the owner in one line roughly how big it is.

## 3. Reporting to the owner

The owner isn't a developer and wants **short** replies.

- Start with **In short**: 3–5 plain bullets — what changed, what it means for players, whether
  it's pushed. No file names or jargon.
- Then **Done / Left / Next**, one short line each.
- Ask only for real decisions (game design choices, money, accounts). Pick sensible defaults for
  the rest and say what you picked.
- Every suggestion says in one line whether it makes the game faster, slower or the same for players.

## 4. Log every change (no asking)

Every change gets a dated line in `CHANGELOG.md` (newest first, with the commit hash) and
`NEXT_STEPS.md` is updated: keep it a current list — remove done items, history belongs in the
changelog.

## 5. Git

- Work on the branch the session was given (or a `claude/...` branch). Push to `main` only when
  the owner says so.
- Run `npm run check` before every commit. Commit in small, described steps.

## 6. Session handoff

Hand off instead of dragging a session on when: a task is done and the next is unrelated; the
conversation was compacted once; ~80+ tool calls; or a big new piece of work starts.

How: rewrite `docs/HANDOFF.md` (under ~5 KB): state in one minute, work in flight with the very
next step, decisions made, traps hit, open items for the owner. Commit and push it, then tell the
owner in one line that it's a good moment to start a new session.

## 7. Keep instruction files small

`CLAUDE.md`/`AGENTS.md` are read every turn: standing rules and pointers only (under ~5 KB).
Long write-ups go under `docs/` and get grepped.

## 8. Running tasks on API credits

`npm run agent -- "task text"` (`scripts/agent/run.ts`) runs one task with the Claude Agent SDK in the
repo root, loads `CLAUDE.md`/`AGENTS.md` (project settings only), streams text and tool names, then
prints status, turns, duration and cost per model. It **bills the `ANTHROPIC_API_KEY`** in the
environment (required; no subscription fallback). Flags: `--model` (default `claude-sonnet-5-5`),
`--max-usd` (default 2, hard stop), `--max-turns` (default 40). Safety: no prompts (`dontAsk`); allowed
are Read/Glob/Grep/Edit/Write and Bash only for `npm run check|build|build:preview`, `npm test*`,
`git status|diff|log`, plus `git add`, `git commit` and `git push origin main` (this repo only; force
push, other branches/remotes, reset, checkout, rebase, clean, rm, installs, curl and web tools are
denied). Cost is the SDK's estimate, not the invoice.

**Memory:** by default each run *resumes the previous run's conversation* (Agent SDK `resume`; the
session id is stored in `.agent/last-session`). `npm run agent -- --new "task"` starts a fresh
conversation. Every successful run's final answer is written to `.agent/last-reply.md`. `.agent/` is
git-ignored. Long chains get expensive (history is re-read): use `--new` for unrelated tasks.

**Every run finishes its own task completely** (the run prompt in `scripts/agent/run.ts` enforces this):
- *Question-only run* (answer/explain/review): changes nothing, commits nothing.
- *Run that changed files*: `npm run check` (and `build` if `apps/`/deps changed). If it **passes**:
  commit the work, add a `CHANGELOG.md` line with that hash, update `NEXT_STEPS.md`, rewrite the
  short `## Last run` section at the top of `docs/HANDOFF.md` (max 10 lines: what changed, what is
  left, very next step), commit that as a docs commit and `git push origin main`.
- If `check` **fails**: nothing is committed or pushed; the failure goes into `## Last run` instead.
- A rejected push is reported, never worked around. Review afterwards with `git log -p`.

