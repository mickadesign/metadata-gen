# Agent tool evals

Three layers, from cheapest to most realistic.

**Scenario evals** (`npm run eval`): scripted agent trajectories over the tool
surface, run twice, once calling the bound tools directly (what WebMCP does in
the page) and once over the JSON-RPC endpoint (what a coding agent's client
does). Each scenario is a user request expressed as the tool calls a competent
agent would make, with checks on results, on server state and on the files
written. Also checks read-tool parity between transports and lints the tool
surface (description budgets, parameter descriptions, write-tool hints).
Fully offline, a few seconds. Report in `evals/results/latest.json`.

**In-page WebMCP eval** (`evals/webmcp-in-page.js`): paste into the DevTools
console on the preview page. Captures the tools the page registers with
`document.modelContext`, calls them the way a browser agent would, and checks
the page reacted: image, controls, revision attributes, consent bar. Works
with or without native WebMCP in the browser.

**Live agent eval** (`npm run eval:live`): a real model drives the tools over
the MCP endpoint from natural-language requests; deterministic graders check
the outcome. Needs Anthropic credentials and spends tokens. Defaults to
`claude-opus-5`; `--model` and `--only <task>` are accepted.
