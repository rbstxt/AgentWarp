# Installing the agentwarp skill

The skill is the directory `skill/agentwarp/` in the agentwarp repo
(`SKILL.md` + `references/`). It teaches a coding agent the whole workflow:
unpack/new → orient → plan with todos → small edit → `check` →
`run --until` / `test` → fix → repeat, plus the input/probe vocabulary,
the test-file schema, Scratch gotchas, and live collaboration via `serve`.
It also points at the per-format reference (`formats/<F>/AGENTS.md`).

Don't install anything into the user's real config — copy/symlink on request:

## Claude Code

Project skill (this repo or a game project): copy to
`<project>/.claude/skills/agentwarp/` (i.e. `SKILL.md` +
`references/` underneath). Personal: `~/.claude/skills/agentwarp/`.

## Codex

Codex reads `AGENTS.md` in the working directory automatically — the
`agentwarp new`/`unpack` commands already write one (pointing at the skill
and the format reference). For a persistent skill, place the directory where
your Codex skills live and reference it from `AGENTS.md`.

## OpenCode

Project: `<project>/.opencode/skills/agentwarp/` (same contents).
Personal: `~/.config/opencode/skills/agentwarp/`. OpenCode also reads the
project `AGENTS.md`, which `new`/`unpack` generate.

## Check it loads

Ask the agent to explain its plan for a Scratch task: it should mention
`check`, `run --until`/`test`, and writing a test per feature. If it
doesn't, paste `skill/agentwarp/SKILL.md` into the chat.
