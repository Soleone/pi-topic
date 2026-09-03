import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { normalizeTopic, truncateToWidth } from "./normalize.ts";
import { fallbackTopic, inferTopic } from "./topic.ts";

const WIDGET_ID = "session-topic";

/**
 * Keep a persistent session topic line above the input editor. The lifecycle
 * mirrors pi-herdr-tabs: a deterministic fallback from the prompt appears
 * immediately at the start of each user request, then a bounded background
 * model request refines it. The topic stays stable across turns and tool
 * executions so it remains readable when the user returns to this pane.
 */
export default function registerPiTopic(pi: ExtensionAPI): void {
  let topic: string | undefined;
  let taskSequence = 0;

  const setTopic = (ui: ExtensionContext["ui"], value: string | undefined): void => {
    topic = value ? normalizeTopic(value) : undefined;
    const current = topic;
    if (!current) {
      ui.setWidget(WIDGET_ID, undefined);
      return;
    }

    // A render factory keeps truncation responsive to the terminal width.
    // ANSI color codes are zero-width for layout purposes because the TUI
    // measures visible width, so truncation is applied to the plain text.
    ui.setWidget(WIDGET_ID, (_tui, theme) => ({
      render(width: number): string[] {
        if (width <= 2) return [];
        return [theme.fg("accent", `◆ ${truncateToWidth(current, width - 2)}`)];
      },
      invalidate() {},
    }));
  };

  pi.on("session_start", (_event, ctx) => {
    // A fresh session starts without stale context from a previous one.
    setTopic(ctx.ui, undefined);
  });

  pi.on("before_agent_start", (event, ctx) => {
    // Show a deterministic subject immediately so the line always tracks the
    // current request even when the model call below fails or times out. The
    // model-inferred topic then refines it in the background without delaying
    // the start of the agent turn.
    const sequence = ++taskSequence;
    setTopic(ctx.ui, fallbackTopic(event.prompt));

    void inferTopic(event.prompt, ctx, debugLogger())
      .then((inferred) => {
        if (!inferred || sequence !== taskSequence) return;
        setTopic(ctx.ui, inferred);
      })
      .catch(() => undefined);
  });

  // The topic is a stable subject for the current user request, not a live
  // tool activity ticker. agent_end can be followed by retry, compaction, or
  // a queued continuation, so nothing resets the line until the next request.

  pi.on("session_shutdown", (_event, ctx) => {
    taskSequence += 1;
    setTopic(ctx.ui, undefined);
  });
}

export { fallbackTopic, inferTopic, parseModelTopic } from "./topic.ts";
export { MAX_TOPIC_LENGTH, normalizeTopic, stripUnsafeText, truncateToWidth } from "./normalize.ts";

function debugLogger(): ((message: string) => void) | undefined {
  const value = process.env.PI_TOPIC_DEBUG;
  const enabled = value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
  return enabled ? (message: string) => console.error(message) : undefined;
}
