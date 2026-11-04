// Runs one development task with the Claude Agent SDK, billed to ANTHROPIC_API_KEY.
// Usage: npm run agent -- [--budget n] [--model id] [--effort level] [--max-turns n] [--continue] "task text"
// Every run starts a FRESH conversation. Memory between runs is the previous final answer (.agent/last-reply.md,
// max 60 lines), given to the new run as context. --continue resumes the full previous conversation instead
// (rare; costs more tokens).
import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const stateDir = join(repoRoot, ".agent");
const sessionFile = join(stateDir, "last-session");
const replyFile = join(stateDir, "last-reply.md");

const USAGE = `Usage: npm run agent -- [--budget <usd>] [--model <id>] [--effort low|medium|high|xhigh|max] [--max-turns <n>] [--continue] "task text"
Every run starts a fresh conversation and gets the previous final answer (.agent/last-reply.md) as context.
--continue resumes the full previous conversation instead (rare; costs more tokens).
Defaults: --model claude-sonnet-5-5  --effort medium  --budget 10  --max-turns 40
Needs ANTHROPIC_API_KEY in the environment (billed to that key, never to a subscription).`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

let model = "claude-sonnet-5-5";
let maxUsd = 10;
let maxTurns = 40;
let resume = false;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
let effort: (typeof EFFORTS)[number] = "medium"; // owner default; pass --effort to change
const words: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--help" || a === "-h") fail(USAGE);
  else if (a === "--continue") resume = true;
  else if (a === "--new") resume = false; // old flag: a fresh conversation is the default now
  else if (a === "--effort") {
    const v = argv[++i];
    if (!v || !(EFFORTS as readonly string[]).includes(v)) fail(`--effort must be one of ${EFFORTS.join(", ")}.\n${USAGE}`);
    effort = v as (typeof EFFORTS)[number];
  } else if (a === "--model" || a === "--budget" || a === "--max-usd" || a === "--max-turns") {
    const v = argv[++i];
    if (v === undefined) fail(`${a} needs a value.\n${USAGE}`);
    if (a === "--model") model = v;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) fail(`${a} must be a positive number.`);
      if (a === "--budget" || a === "--max-usd") maxUsd = n;
      else maxTurns = Math.floor(n);
    }
  } else words.push(a);
}
const task = words.join(" ").trim();
if (!task) fail(USAGE);

if (!process.env.ANTHROPIC_API_KEY) {
  fail("ANTHROPIC_API_KEY is not set. Export it first; this runner never falls back to a Claude subscription login.");
}

const APPEND = `You are running unattended via "npm run agent" on the Clanfire repo (this repo only: never touch other repos). Follow AGENTS.md and docs/STANDARDS.md. Do not install packages. You cannot ask questions; make reasonable choices and state them in your final answer.

This run is a fresh conversation. The previous run's final answer may be given before the task as context (for follow-ups such as "do step 2"); treat the task as its own: finish it completely and end in a clean state. Decide which kind of run this is:

A) Question-only run (the task only asks for an answer, explanation or review): change nothing. No file edits, no commit, no push. Just answer.

B) Run that changed files. Finish with this protocol, in order:
 1. Run "npm run check" (plus "npm run build" if apps/ or dependencies changed).
 2. If it PASSES:
    a. "git add -A" then "git commit" the work (clear message; end it with the Co-Authored-By line from your instructions if you have one). Never commit secrets, data/ or *.sqlite.
    b. Take the hash from "git log -1 --format=%h". Add a dated line (newest first, with that hash) at the top of CHANGELOG.md; update NEXT_STEPS.md (remove done items, add follow-ups).
    c. Update the "## Last run" section at the very top of docs/HANDOFF.md (create it right under the title if missing; replace its old content; max 10 lines): what changed, what is left, the very next step, and "checks passed".
    d. "git add -A", "git commit" (docs commit), then "git push origin main".
 3. If it FAILS: do NOT commit and do NOT push. Leave the changes in the working tree and write the failure (which check, first real error, what you tried) into the "## Last run" section of docs/HANDOFF.md (max 10 lines, say "checks FAILED, nothing committed"). That file edit stays uncommitted too.
 Allowed git: status, diff, log, add, commit, and "git push origin main" only. No force push, other branches, other remotes, reset, checkout, rebase or clean. If a push is rejected, do not work around it: report it in your final answer.

If a Bash command is denied, it is usually because one part of a chained command is not on the allow list: retry with simpler single commands (no pipes, no ";") before giving up.

Final answer: say what changed, whether it was committed/pushed (hashes), what is left, and the next step.`;

const bash = (p: string) => `Bash(${p})`;
const allowedTools = [
  "Read", "Glob", "Grep", "Edit", "Write",
  ...[
    // Chained commands (a && b | c) are checked part by part, so every part must be listed here.
    "npm run check", "npm run check *", "npm run build", "npm run build *", "npm run build:preview",
    "npm run build:preview *", "npm test", "npm test *",
    // Balance simulator (docs/BALANCE.md section 6): read-only on the repo apart from stdout.
    "npm run sim", "npm run sim *",
    // Read-only helpers the agent uses to look at output and files.
    "head *", "tail *", "cat *", "ls", "ls *", "wc *", "grep *", "echo *", "sed -n *", "sort *", "uniq *",
    "git show *", "git rev-parse *",
    "git status", "git status *", "git diff", "git diff *", "git log", "git log *",
    "git add -A", "git add .", "git add *", "git commit *", "git push origin main",
  ].map(bash),
];
// Deny rules win over allow rules, so force pushes etc. stay blocked.
const disallowedTools = [
  "WebFetch", "WebSearch",
  ...[
    "git push --force*", "git push -f*", "git push * --force*", "git push *+*", "git push --delete*", "git push --mirror*",
    "git -C *", "git remote *", "git config *", "git reset*", "git checkout*", "git switch*", "git rebase*", "git clean*", "git stash*", "git branch -D*",
    "rm *", "sudo *", "npm install*", "npm i *", "curl *", "wget *",
  ].map(bash),
];

let resumeId: string | undefined;
if (resume && existsSync(sessionFile)) {
  const id = readFileSync(sessionFile, "utf8").trim();
  if (/^[0-9a-zA-Z-]{8,}$/.test(id)) resumeId = id;
}
if (resume && !resumeId) console.log("No previous conversation to continue; starting a fresh one.");
console.log(resumeId ? `Continuing previous conversation (${resumeId}).` : "Starting a fresh conversation.");
console.log(`Model ${model}, effort ${effort}, budget $${maxUsd}.`);

// Cheap memory: the previous final answer, capped, goes in front of the task.
const REPLY_MAX_LINES = 60;
const capLines = (text: string): string => {
  const lines = text.trim().split("\n");
  return lines.length <= REPLY_MAX_LINES ? lines.join("\n") : lines.slice(0, REPLY_MAX_LINES - 1).join("\n") + "\n[... shortened to 60 lines]";
};
let prompt = task;
if (!resumeId && existsSync(replyFile)) {
  const prev = capLines(readFileSync(replyFile, "utf8"));
  if (prev) {
    prompt = `Context only (final answer of the previous run; may be outdated, check the repo and docs/HANDOFF.md before relying on it):\n<previous-run>\n${prev}\n</previous-run>\n\nYour task now:\n${task}`;
  }
}

const started = Date.now();
let turns = 0;
let exitCode = 1;
let sawResult = false;

try {
  const q = query({
    prompt,
    options: {
      cwd: repoRoot,
      model,
      maxTurns,
      maxBudgetUsd: maxUsd,
      effort,
      settingSources: ["project"], // loads CLAUDE.md / AGENTS.md; not user or local settings
      systemPrompt: { type: "preset", preset: "claude_code", append: APPEND },
      permissionMode: "dontAsk", // anything not allowed is denied, never prompts
      allowedTools,
      disallowedTools,
      env: { ...process.env },
      ...(resumeId ? { resume: resumeId } : {}),
    },
  });

  for await (const m of q) {
    if ("session_id" in m && typeof m.session_id === "string" && m.session_id) {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(sessionFile, m.session_id + "\n");
    }
    if (m.type === "assistant") {
      for (const block of m.message.content) {
        if (block.type === "text" && block.text.trim()) console.log(block.text.trim());
        else if (block.type === "tool_use") {
          const inp = block.input as Record<string, unknown>;
          const hint = String(inp.command ?? inp.file_path ?? inp.pattern ?? inp.path ?? "").slice(0, 100);
          console.log(`  [tool] ${block.name}${hint ? " " + hint : ""}`);
        }
      }
    } else if (m.type === "result") {
      sawResult = true;
      if (m.subtype === "success" && typeof m.result === "string") {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(replyFile, capLines(m.result) + "\n");
      }
      turns = m.num_turns;
      const secs = (m.duration_ms / 1000).toFixed(1);
      console.log("\n--- result ---");
      console.log(`status:   ${m.subtype}${m.is_error ? " (error)" : ""}`);
      console.log(`turns:    ${m.num_turns}`);
      console.log(`duration: ${secs}s`);
      console.log(`cost:     $${m.total_cost_usd.toFixed(4)} (estimate; budget $${maxUsd})`);
      for (const [name, u] of Object.entries(m.modelUsage ?? {})) {
        console.log(`  ${name}: in ${u.inputTokens}, out ${u.outputTokens}, cache read ${u.cacheReadInputTokens}, cache write ${u.cacheCreationInputTokens}, $${u.costUSD.toFixed(4)}`);
      }
      if (m.subtype !== "success") {
        const why = m.subtype === "error_max_budget_usd" ? "budget reached" : m.subtype === "error_max_turns" ? "turn limit reached" : m.subtype;
        console.error(`Stopped: ${why}.`);
      }
      exitCode = m.subtype === "success" && !m.is_error ? 0 : 1;
    }
  }
} catch (err) {
  // Never print env; only the error message.
  console.error(`Run failed: ${(err as Error).message}`);
  if (!sawResult) console.error(`(after ${turns} turns, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
}
process.exit(exitCode);
