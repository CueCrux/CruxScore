#!/usr/bin/env bash
# One cold headless probe session for CDB. No live MCP tools — the treatment is
# the context block already prepended to the prompt, not tool-reach (Protocol §2).
# usage: run_cell.sh <sandbox-cwd> <prompt-file> <out-dir> [model] [max-turns]
set -euo pipefail
# Pluggable model driver: bring your own model by pointing CDB_DRIVER at an
# executable taking the same args (see BACKENDS.md). Default = the claude CLI.
if [ -n "${CDB_DRIVER:-}" ]; then exec "$CDB_DRIVER" "$@"; fi
# The `claude` binary is frequently NOT on PATH — VS Code ships it inside the
# extension directory. A bare `claude` then fails with "command not found",
# every probe scores 0, and the matrix still prints ALL_PASS: a silent zero that
# looks exactly like a model that answered nothing. Resolve it explicitly.
CLAUDE_BIN="${CDB_CLAUDE_BIN:-${CLAUDE_CODE_EXECPATH:-claude}}"
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1 && [ ! -x "$CLAUDE_BIN" ]; then
  echo "FATAL: claude binary not found (tried '$CLAUDE_BIN'). Set CDB_CLAUDE_BIN or CLAUDE_CODE_EXECPATH." >&2
  exit 127
fi
# Resolve to ABSOLUTE paths before we cd into the sandbox — otherwise a relative
# --out makes the prompt/mcp paths resolve relative to $CWD (doubled/missing).
CWD=$(cd "$1" && pwd); PROMPT=$(readlink -f "$2"); mkdir -p "$3"; OUT=$(readlink -f "$3"); MODEL=${4:-sonnet}; MAXT=${5:-20}
ALLOWED="Bash,Read,Write,Edit,Glob,Grep,TodoWrite"
cp "$PROMPT" "$OUT/prompt.md"
EMPTY_MCP="$OUT/empty.mcp.json"; echo '{"mcpServers":{}}' > "$EMPTY_MCP"
# Tolerate non-zero exits (e.g. error_max_turns): a cold agent that can't answer
# should score 0 via a missing/partial answers.json, NOT abort the matrix.
(
  cd "$CWD"
  # Prompt goes in on STDIN, never as an argv element. A tiered CDB prompt is
  # hundreds of KB (D4 is ~200KB) and blows past ARG_MAX, which the shell reports
  # as "Argument list too long" — the cell then scores 0/20 and reads as a model
  # that answered nothing. Every rung above ~D3 was unrunnable because of this.
  "$CLAUDE_BIN" -p \
    --model "$MODEL" --max-turns "$MAXT" \
    --mcp-config "$EMPTY_MCP" --strict-mcp-config \
    --allowedTools "$ALLOWED" --permission-mode acceptEdits \
    --output-format json
) < "$PROMPT" > "$OUT/result.json" 2> "$OUT/stderr.log" || echo "warn: non-zero exit (likely max_turns) cwd=$CWD" >&2
SID=$(jq -r '.session_id' "$OUT/result.json" 2>/dev/null || echo "")
SLUG=$(echo "$CWD" | sed 's#[/.]#-#g')
T="$HOME/.claude/projects/$SLUG/$SID.jsonl"
[ -f "$T" ] && cp "$T" "$OUT/transcript.jsonl" || echo "warn: no transcript $T" >&2
echo "ok cwd=$CWD turns=$(jq -r .num_turns "$OUT/result.json" 2>/dev/null) sid=$SID"
