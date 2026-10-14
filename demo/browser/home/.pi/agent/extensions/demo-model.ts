// A scripted model, so the demo runs real pi without an API key and nothing leaves the browser.
// Each prompt below has a fixed run of replies; the tools they call (read, edit, bash) are real.
// pi-topic asks the same model for a topic in the background, so that request gets a scripted topic too.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";

const model = {
  id: "scripted",
  name: "Scripted",
  reasoning: true,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_000,
};

const oslo = '  oslo: { sky: "light rain", high: 9, low: 4, rain: 0.8 },';
const newYork = `${oslo}\n  "new york": { sky: "partly cloudy", high: 18, low: 11, rain: 0.2 },`;
const oldError = "console.error(`No forecast for ${city}. Try Berlin, Lisbon or Oslo.`);";
const newError = "console.error(`No forecast for ${city}. Try Berlin, Lisbon, New York or Oslo.`);";
const oldLine = 'console.log(`${city}: ${reading.sky}, ${reading.low}-${reading.high}°C, ${Math.round(reading.rain * 100)}% chance of rain`);';
const newLines = `if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ city, ...reading }));
} else {
  ${oldLine}
}`;

type Step = ReturnType<typeof fauxAssistantMessage>;
const toolUse = { stopReason: "toolUse" as const };

// Matched against the latest prompt: the replies in order (one per model request), and the topic pi-topic gets back.
const scripts: { match: RegExp; topic: string; steps: Step[] }[] = [
  {
    match: /new york/i,
    topic: "Forecast sample data: adding New York",
    steps: [
      fauxAssistantMessage([fauxThinking("The cities come from the bundled sample; check it and the error message."), fauxToolCall("read", { path: "src/readings.js" }), fauxToolCall("read", { path: "src/cli.js" })], toolUse),
      fauxAssistantMessage([fauxThinking("Add a reading and name it in the error hint."), fauxToolCall("edit", { path: "src/readings.js", edits: [{ oldText: oslo, newText: newYork }] }), fauxToolCall("edit", { path: "src/cli.js", edits: [{ oldText: oldError, newText: newError }] })], toolUse),
      fauxAssistantMessage([fauxToolCall("bash", { command: 'node src/cli.js "New York"' })], toolUse),
      fauxAssistantMessage([fauxText("New York was simply missing from the sample in `src/readings.js`. I added a reading for it and listed it in the error hint, so `forecast \"New York\"` works now.")]),
    ],
  },
  {
    match: /json/i,
    topic: "Forecast CLI: machine-readable JSON output",
    steps: [
      fauxAssistantMessage([fauxThinking("A flag check around the final print is enough; keep the text output as it is."), fauxToolCall("edit", { path: "src/cli.js", edits: [{ oldText: oldLine, newText: newLines }] })], toolUse),
      fauxAssistantMessage([fauxToolCall("bash", { command: "node src/cli.js Lisbon --json && node src/cli.js Lisbon" })], toolUse),
      fauxAssistantMessage([fauxText("Added `--json`: it prints the reading as one JSON object, and the plain output is unchanged.")]),
    ],
  },
];

const fallback = fauxAssistantMessage([
  fauxText("I'm a scripted stand-in for a model, so I only know a few prompts. Try **the forecast for new york is missing** or **add a --json flag**, and watch the ◆ line above the input: it shows your prompt right away, then the topic the model sums it up as."),
]);

function text(content: unknown): string {
  return typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part?.text ?? "").join(" ") : "";
}

function nextStep(context: { messages: { role: string; content: unknown }[] }): Step {
  const lastUser = context.messages.findLastIndex((message) => message.role === "user");
  const prompt = text(context.messages[lastUser]?.content);
  const replies = context.messages.slice(lastUser + 1).filter((message) => message.role === "assistant").length;
  const script = scripts.find((candidate) => candidate.match.test(prompt));
  return script?.steps[replies] ?? (replies === 0 ? fallback : fauxAssistantMessage([fauxText("Done.")]));
}

// pi-topic's request carries the prompt before "Recent session context:"; an unknown prompt gets a generic word, which pi-topic ignores.
function topicReply(context: { messages: { content: unknown }[] }): Step {
  const request = text(context.messages.at(-1)?.content).split("Recent session context:")[0];
  const script = scripts.find((candidate) => candidate.match.test(request));
  return fauxAssistantMessage([fauxText(script?.topic ?? "Session")]);
}

const isTopicRequest = (context: { systemPrompt?: string }) => context.systemPrompt?.includes("session topic line") ?? false;

export default function demoModel(pi: ExtensionAPI): void {
  const agent = createFauxCore({ provider: "demo", api: "demo-scripted", models: [model], tokensPerSecond: 90 });
  // A second core for the topic requests, which run alongside the agent's turn.
  const topics = createFauxCore({ provider: "demo", api: "demo-scripted", models: [model], tokensPerSecond: 40 });
  pi.registerProvider("demo", {
    name: "Demo",
    baseUrl: "http://demo.invalid",
    apiKey: "demo",
    api: "demo-scripted" as never,
    models: [model],
    streamSimple: (requestModel, context, options) => {
      if (!isTopicRequest(context)) {
        agent.setResponses([nextStep(context as never)]);
        return agent.streamSimple(requestModel as never, context, options);
      }
      // A real model takes a moment; the pause leaves the prompt's own first line on screen long enough to read.
      const delayed = createAssistantMessageEventStream();
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        topics.setResponses([topicReply(context as never)]);
        for await (const event of topics.streamSimple(requestModel as never, context, options)) delayed.push(event);
        delayed.end();
      })();
      return delayed;
    },
  });
}
