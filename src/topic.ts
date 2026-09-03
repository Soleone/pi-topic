import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { normalizeTopic } from "./normalize.ts";

const MAX_SESSION_EXCERPT = 8_000;
const MAX_SESSION_MESSAGES = 8;
// The topic request runs alongside the agent turn instead of blocking it, so
// it can tolerate slow providers. Reasoning models spend hidden thinking
// tokens before any text output, and those count against the output budget,
// so the budget must be generous enough to leave room for one short block.
const TOPIC_TIMEOUT_MS = 15_000;
const TOPIC_MAX_TOKENS = 1024;
const TOPIC_SYSTEM_PROMPT = [
  "You maintain a persistent session topic line shown above the input of an AI coding agent.",
  "Describe the ongoing goal or theme of the session as a whole, informed by the recent context.",
  "Never restate or lightly paraphrase the current user message; abstract away from its literal wording.",
  "For example, for 'why does my test fail after refactor' write 'Test suite debugging', not the question itself.",
  "Return only a single-line noun phrase of at most 120 characters.",
  "Prefer a specific feature, bug, file, endpoint, or project area over generic descriptions.",
  "Never return generic status words such as Working, Planning, Thinking, Coding Session, or Done.",
  "Do not include markdown, quotes, URLs, credentials, or filesystem paths.",
].join(" ");

const GENERIC_TOPICS = new Set([
  "answer",
  "complete",
  "completed",
  "coding",
  "continuing",
  "done",
  "in progress",
  "planning",
  "processing",
  "request",
  "session",
  "task",
  "thinking",
  "working",
]);

type TopicContext = Pick<
  ExtensionContext,
  "model" | "modelRegistry" | "sessionManager" | "signal"
>;

/**
 * Derive a deterministic fallback topic directly from the prompt. Used to
 * update the widget immediately when a user request starts; the model-inferred
 * topic refines it later in the background.
 */
export function fallbackTopic(prompt: string): string | undefined {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  // Slash commands are not topics and expand before this point.
  if (!firstLine || firstLine.startsWith("/")) return undefined;
  return normalizeTopic(firstLine);
}

/**
 * Ask Pi's currently selected model for the session topic. This runs alongside
 * the main agent turn instead of blocking it: a fallback from the prompt is
 * written first, and this request refines it when it completes. A failed or
 * unavailable request simply leaves the current topic alone.
 */
export async function inferTopic(
  prompt: string,
  ctx: TopicContext,
  logger?: (message: string) => void,
): Promise<string | undefined> {
  const model = ctx.model;
  if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) return undefined;

  const sessionEntries = ctx.sessionManager.buildContextEntries();
  const request = [
    "Current user request:",
    prompt.trim() || "(empty)",
    "",
    "Recent session context:",
    buildSessionExcerpt(sessionEntries),
  ].join("\n");

  try {
    const response = await ctx.modelRegistry.complete(
      model,
      {
        systemPrompt: TOPIC_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: request }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        signal: ctx.signal,
        timeoutMs: TOPIC_TIMEOUT_MS,
        maxRetries: 0,
        maxTokens: TOPIC_MAX_TOKENS,
        cacheRetention: "none",
        sessionId: ctx.sessionManager.getSessionId(),
      },
    );

    const topic = parseModelTopic(response.content);
    if (!topic) {
      logger?.("pi-topic: model returned an unusable topic");
    } else {
      logger?.(`pi-topic: refined topic: ${topic}`);
    }
    return topic;
  } catch (error) {
    logger?.(
      `pi-topic: topic request failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return undefined;
  }
}

function buildSessionExcerpt(entries: readonly unknown[]): string {
  const lines = entries
    .slice(-MAX_SESSION_MESSAGES)
    .map(formatEntry)
    .filter((line): line is string => Boolean(line));

  const excerpt = lines.join("\n");
  if (excerpt.length <= MAX_SESSION_EXCERPT) return excerpt || "(none)";
  return `…${excerpt.slice(-(MAX_SESSION_EXCERPT - 1))}`;
}

function formatEntry(entry: unknown): string | undefined {
  if (!isRecord(entry)) return undefined;

  if (entry.type === "message") {
    return formatMessage(entry.message);
  }
  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return `session summary: ${truncateInline(entry.summary)}`;
  }
  if (entry.type === "branch_summary" && typeof entry.summary === "string") {
    return `branch summary: ${truncateInline(entry.summary)}`;
  }
  return undefined;
}

function formatMessage(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;

  const role = typeof message.role === "string" ? message.role : "message";
  const content = extractContentText(message.content);
  if (!content) return undefined;
  return `${role}: ${content}`;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return truncateInline(content);
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    } else if (item.type === "toolCall" && typeof item.name === "string") {
      parts.push(`[tool: ${item.name}]`);
    }
  }

  return truncateInline(parts.join(" "));
}

function truncateInline(value: string): string {
  const singleLine = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return singleLine.length > 1_200 ? `${singleLine.slice(0, 1_197)}...` : singleLine;
}

export function parseModelTopic(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;

  const rawText = content
    .filter(isRecord)
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
  if (!rawText) return undefined;

  const firstLine = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("```"));
  if (!firstLine) return undefined;

  const candidate = firstLine
    .replace(/^(?:topic|title)\s*:\s*/i, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim();
  if (!candidate) return undefined;

  const normalized = normalizeTopic(candidate);
  return GENERIC_TOPICS.has(normalized.toLowerCase()) ? undefined : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
