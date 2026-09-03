import assert from "node:assert/strict";
import test from "node:test";

import { fallbackTopic, inferTopic, parseModelTopic } from "../src/topic.ts";

function makeCtx(overrides?: Record<string, unknown>) {
  return {
    model: { provider: "test", id: "model" },
    modelRegistry: {
      hasConfiguredAuth: () => true,
      async complete(_model: unknown, _context: unknown, _options: unknown) {
        return { content: [{ type: "text", text: "Auth Token Refresh" }] };
      },
    },
    sessionManager: {
      buildContextEntries: () => [
        {
          type: "message",
          message: {
            role: "user",
            content: [{ type: "text", text: "We are updating the authentication flow." }],
          },
        },
      ],
      getSessionId: () => "session-1",
    },
    signal: undefined,
    ...overrides,
  };
}

test("derives a fallback topic from the prompt", () => {
  assert.equal(fallbackTopic("Fix the auth refresh bug\nsecond line"), "Fix the auth refresh bug");
  assert.equal(fallbackTopic("   \n  list all files  "), "list all files");
  assert.equal(fallbackTopic("/compact"), undefined);
  assert.equal(fallbackTopic(""), undefined);
});

test("asks the active model for a topic using recent session context", async () => {
  const calls: Array<{ context: any; options: any }> = [];
  const ctx = makeCtx({
    modelRegistry: {
      hasConfiguredAuth: () => true,
      async complete(_model: unknown, context: any, options: any) {
        calls.push({ context, options });
        return { content: [{ type: "text", text: "Auth Token Refresh Flow" }] };
      },
    },
  });

  const topic = await inferTopic("Fix the refresh bug", ctx as never);

  assert.equal(topic, "Auth Token Refresh Flow");
  assert.equal(calls.length, 1);
  const request = calls[0]!.context.messages[0]!.content[0]!.text as string;
  assert.equal(request.includes("Fix the refresh bug"), true);
  assert.equal(request.includes("authentication flow"), true);
  assert.equal(calls[0]!.options.sessionId, "session-1");
  assert.equal(calls[0]!.options.maxTokens, 1024);
});

test("returns undefined without a configured model or auth", async () => {
  const noModel = await inferTopic("prompt", { ...makeCtx(), model: undefined } as never);
  assert.equal(noModel, undefined);

  const noAuth = await inferTopic("prompt", makeCtx({
    modelRegistry: { hasConfiguredAuth: () => false },
  }) as never);
  assert.equal(noAuth, undefined);
});

test("returns undefined when the request fails", async () => {
  const ctx = makeCtx({
    modelRegistry: {
      hasConfiguredAuth: () => true,
      async complete() {
        throw new Error("boom");
      },
    },
  });
  const logs: string[] = [];
  const topic = await inferTopic("prompt", ctx as never, (m) => logs.push(m));
  assert.equal(topic, undefined);
  assert.equal(logs.length, 1);
});

test("rejects generic status topics", () => {
  assert.equal(parseModelTopic([{ type: "text", text: "Working" }]), undefined);
  assert.equal(parseModelTopic([{ type: "text", text: "Done" }]), undefined);
  assert.equal(
    parseModelTopic([{ type: "text", text: "Topic: Fix login redirect loop" }]),
    "Fix login redirect loop",
  );
  assert.equal(parseModelTopic([]), undefined);
});
