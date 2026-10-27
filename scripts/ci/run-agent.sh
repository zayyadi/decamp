#!/usr/bin/env bash
# The "Run agent" step of .github/workflows/agent.yml, kept here so it can be
# tested (tests/ci/run-agent.test.ts).
#
# A scheduled run with no model credentials for the chosen backend still
# ingests, so articles pile up for classification once credentials exist
# (pending articles are classified oldest first, whatever their age). It says
# so in a warning and in the run summary rather than failing every 15 minutes.
# Manual runs do exactly what was asked and fail loudly instead.
#
# Inputs (env): STAGE (all|ingest|classify), DRY_RUN (true|false),
# AGENT_LLM_BACKEND (api|claude-cli), ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN,
# GITHUB_EVENT_NAME and GITHUB_STEP_SUMMARY (set by Actions).
set -euo pipefail

stage="${STAGE:-all}"
backend="${AGENT_LLM_BACKEND:-api}"

case "$backend" in
  api) credential="ANTHROPIC_API_KEY"; has_llm="${ANTHROPIC_API_KEY:-}" ;;
  claude-cli) credential="CLAUDE_CODE_OAUTH_TOKEN"; has_llm="${CLAUDE_CODE_OAUTH_TOKEN:-}" ;;
  *)
    echo "::error title=Agent misconfigured::AGENT_LLM_BACKEND must be api or claude-cli, not '$backend'"
    exit 1
    ;;
esac

if [ -z "$has_llm" ] && [ "$stage" = "all" ] && [ "${GITHUB_EVENT_NAME:-}" = "schedule" ]; then
  stage="ingest"
  message="$credential is not set for the $backend backend, so this run only collected articles (ingest stage). They will be classified on the first run after the secret is added."
  echo "::warning title=Classification skipped::$message"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '> [!WARNING]\n> **Classification skipped.** %s\n\n' "$message" >> "$GITHUB_STEP_SUMMARY"
  fi
fi

args=(--stage="$stage")
if [ "${DRY_RUN:-false}" = "true" ]; then
  args+=(--dry-run)
fi

# pipefail makes the agent's exit code the step's, not tee's.
npm run agent -- "${args[@]}" 2>&1 | tee agent-run.log
