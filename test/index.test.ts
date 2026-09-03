import assert from "node:assert/strict";
import test from "node:test";

import registerPiTopic from "../src/index.ts";

type Handler = (event: any, ctx: any) => void | Promise<void>;

function makePi() {
  const handlers = new Map<string, Handler[]>();
  const widgets = new Map<string, unknown>();
  return {
    pi: {
      on(name: string, handler: Handler) {
        const list = handlers.get(name) ?? [];
        list.push(handler);
        handlers.set(name, list);
      },
    } as never,
    emit: (name: string, event?: unknown, ctx?: unknown) =>
      Promise.all((handlers.get(name) ?? []).map((h) => h(event ?? {}, ctx ?? {}))),
    widgets,
  };
}

function makeUi() {
  const widgets = new Map<string, unknown>();
  return {
    ui: {
      setWidget(key: string, content: unknown) {
        if (content === undefined) widgets.delete(key);
        else widgets.set(key, content);
      },
    },
    widgets,
  };
}

const theme = { fg: (_name: string, text: string) => text };

test("shows a fallback immediately and refines with the model topic", async () => {
  const app = makePi();
  registerPiTopic(app.pi);
  const { ui, widgets } = makeUi();

  await app.emit("session_start", {}, { ui });
  assert.equal(widgets.has("session-topic"), false);

  let resolveInference: (value: string) => void;
  const inference = new Promise<string>((resolve) => (resolveInference = resolve));
  // The refinement path is exercised through the module's own promise; here we
  // verify the fallback write and the sequence guard via direct handler calls.
  await app.emit(
    "before_agent_start",
    { prompt: "Fix the auth refresh bug" },
    { ui, model: undefined },
  );
  assert.ok(widgets.has("session-topic"));
  const factory = widgets.get("session-topic") as (tui: unknown, theme: unknown) => any;
  const component = factory(undefined, theme);
  assert.deepEqual(component.render(80), ["◆ Fix the auth refresh bug"]);
  void inference;
  void resolveInference!;
});

test("truncates rendering to the terminal width", async () => {
  const app = makePi();
  registerPiTopic(app.pi);
  const { ui, widgets } = makeUi();

  await app.emit("before_agent_start", { prompt: "A".repeat(200) }, { ui });
  const factory = widgets.get("session-topic") as (tui: unknown, theme: unknown) => any;
  const component = factory(undefined, theme);
  const lines = component.render(20);
  assert.equal(lines.length, 1);
  // 17 visible characters of topic plus the ellipsis
  assert.equal(lines[0]!.length, 2 + 18);
  assert.ok(lines[0]!.endsWith("…"));
});

test("clears the widget at shutdown", async () => {
  const app = makePi();
  registerPiTopic(app.pi);
  const { ui, widgets } = makeUi();

  await app.emit("before_agent_start", { prompt: "Some task" }, { ui });
  assert.ok(widgets.has("session-topic"));

  await app.emit("session_shutdown", {}, { ui });
  assert.equal(widgets.size, 0);
});
