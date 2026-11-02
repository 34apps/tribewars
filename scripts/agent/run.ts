// Runs one development task with the Claude Agent SDK, billed to ANTHROPIC_API_KEY.
// Usage: npm run agent -- [--model id] [--max-usd n] [--max-turns n] "task text"
import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const USAGE = `Usage: npm run agent -- [--model <id>] [--max-usd <n>] [--max-turns <n>] "task text"
Defaults: --model claude-sonnet-5-5  --max-usd 2  --max-turns 40
Needs ANTHROPIC_API_KEY in the environment (billed to that key, never to a subscription).`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

let model = "claude-sonnet-5-5";
let maxUsd = 2;
let maxTurns = 40;
const words: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--help" || a === "-h") fail(USAGE);
  else if (a === "--model" || a === "--max-usd" || a === "--max-turns") {
    const v = argv[++i];
    if (v === undefined) fail(`${a} needs a value.\n${USAGE}`);
    if (a === "--model") model = v;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) fail(`${a} must be a positive number.`);
      if (a === "--max-usd") maxUsd = n;
      else maxTurns = Math.floor(n);
    }
  } else words.push(a);
}
const task = words.join(" ").trim();
if (!task) fail(USAGE);

if (!process.env.ANTHROPIC_API_KEY) {
  fail("ANTHROPIC_API_KEY is not set. Export it first; this runner never falls back to a Claude subscription login.");
}

const APPEND = `You are running unattended via "npm run agent" on the Clanfire repo. Follow AGENTS.md and docs/STANDARDS.md. Do NOT run git commit, git push or any other git write command, and do not install packages: leave all changes uncommitted in the working tree, the owner reviews them. You cannot ask questions; make reasonable choices and state them in your final answer. Run npm run check before you finish if you changed code.`;

const bash = (p: string) => `Bash(${p})`;
const allowedTools = [
  "Read", "Glob", "Grep", "Edit", "Write",
  ...["npm run check", "npm run build", "npm run build:preview", "npm test", "npm test *", "git status", "git status *", "git diff", "git diff *", "git log", "git log *"].map(bash),
];
const disallowedTools = [
  "WebFetch", "WebSearch",
  ...["git commit*", "git push*", "git reset*", "git checkout*", "git clean*", "rm *", "sudo *", "npm install*", "npm i *", "curl *", "wget *"].map(bash),
];

const started = Date.now();
let turns = 0;
let exitCode = 1;
let sawResult = false;

try {
  const q = query({
    prompt: task,
    options: {
      cwd: repoRoot,
      model,
      maxTurns,
      maxBudgetUsd: maxUsd,
      settingSources: ["project"], // loads CLAUDE.md / AGENTS.md; not user or local settings
      systemPrompt: { type: "preset", preset: "claude_code", append: APPEND },
      permissionMode: "dontAsk", // anything not allowed is denied, never prompts
      allowedTools,
      disallowedTools,
      env: { ...process.env },
    },
  });

  for await (const m of q) {
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
