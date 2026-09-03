export const MAX_TOPIC_LENGTH = 140;

const ANSI_ESCAPE_RE = /(?:\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|\u009b[0-?]*[ -/]*[@-~])/g;
const URL_RE = /\b(?:(?:https?|ftp):\/\/|www\.)[^\s<>{}\[\]"']+/gi;
const CREDENTIAL_RE = /\b(?:sk-[A-Za-z0-9_-]+|rk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+)\b/gi;
const ASSIGNMENT_SECRET_RE = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|token)\b\s*[:=]\s*[^\s,;]+/gi;
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+\/-]{8,}/gi;
const PATH_RE = /(?:^|\s)(?:~|\/{1,2}|[a-z]:[\\/])[^\s]+/gi;

/** Remove terminal escape sequences and ASCII/Unicode control characters. */
export function stripUnsafeText(value: string): string {
  return value
    .replace(ANSI_ESCAPE_RE, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

/**
 * Make a topic safe to render in the terminal and enforce a generous budget.
 * Unlike the Herdr tab label, the topic line is not capped at 24 code points;
 * the widget truncates visually to the terminal width instead.
 * This is the final normalization used by every topic path.
 */
export function normalizeTopic(value: string, fallback = "Untitled session"): string {
  const cleaned = stripUnsafeText(value)
    .replace(URL_RE, " ")
    .replace(CREDENTIAL_RE, " ")
    .replace(ASSIGNMENT_SECRET_RE, " ")
    .replace(BEARER_RE, " ")
    .replace(PATH_RE, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return limitCodePoints(fallback.trim() || "Untitled session");
  return limitCodePoints(cleaned);
}

/** Enforce the code-point limit without splitting a UTF-16 surrogate pair. */
function limitCodePoints(value: string): string {
  return Array.from(value).slice(0, MAX_TOPIC_LENGTH).join("").trim();
}

/** Approximate visible width by code point; good enough for truncation. */
export function truncateToWidth(value: string, width: number): string {
  if (width <= 0) return "";
  const codePoints = Array.from(value);
  if (codePoints.length <= width) return value;
  return `${codePoints.slice(0, Math.max(0, width - 1)).join("")}…`;
}
