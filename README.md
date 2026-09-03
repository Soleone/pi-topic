# pi-topic

A small Pi extension that shows a persistent **session topic** line directly
above the input editor. It asks Pi's active model for a compact task subject
and keeps that subject stable for the current user request - the same content
pi-herdr-tabs writes to a Herdr tab, but rendered inside Pi itself where the
character budget is generous.

## Why

Herdr tab titles are capped at roughly 24 characters, which forces terse,
sometimes cryptic labels. The widget above Pi's input has no such limit: the
topic can be a full readable sentence fragment, truncates only visually to the
terminal width, and works in any terminal whether or not Herdr is running.

## How it works

- On each user request (`before_agent_start`), a deterministic fallback topic
  derived from the prompt's first line appears immediately.
- In parallel, a bounded background request (8 s timeout, 256 output tokens)
  asks Pi's currently selected model for a refined topic using the prompt plus
  a compact excerpt of the session context.
- Once set, the topic stays stable across turns and tool executions. A late
  refinement from an older request never overwrites a newer one.
- A new user request can establish a new topic; slash commands do not.
- The widget is cleared on session start and shutdown so stale topics never
  leak between sessions.

Topics are sanitized (escape sequences, URLs, credentials, and filesystem
paths are stripped) and capped at 140 Unicode code points of stored content,
which is sized so a full topic fits a single terminal line without wrapping;
rendering additionally truncates to the live terminal width with an ellipsis
as a safety net.

## Development and loading

```bash
npm install
npm run check
npm test

# Quick local load for one Pi process
pi -e ./src/index.ts

# Or install as a project-local Pi package
pi install -l "$PWD"
```

When editing an auto-discovered copy, run `/reload` in the Pi pane or restart
Pi before testing.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PI_TOPIC_DEBUG=1` | Log short, sanitized topic-request failure messages. |

## Relationship to pi-herdr-tabs

pi-topic is standalone: no Herdr CLI, no `HERDR_*` variables, no crash-recovery
state file, and no label restoration on shutdown - the widget lives entirely
inside the Pi TUI. The two extensions can run side by side, or pi-topic can
replace pi-herdr-tabs if the tab title is no longer needed.

## Manual smoke test

1. Load with `pi -e ./src/index.ts`.
2. Submit `Fix the auth refresh bug` and confirm a `◆ Fix the auth refresh bug`
   line appears above the input immediately, then gets refined by the model.
3. Run a task that reads, searches, edits, and tests files, and confirm the
   topic stays put throughout.
4. Start a second user request and confirm the topic updates.
5. Narrow the terminal and confirm the topic truncates instead of wrapping.
