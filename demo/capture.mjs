#!/usr/bin/env node
// Records the browser demo (demo/browser) as the README loop, and the hero from its last frame:
// two scripted requests, each showing its own words on the ◆ line first and then the topic the model sums it up as.
// Usage: npm run media:capture. Needs agent-browser (with its browser installed) and FFmpeg on the PATH.
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { record } from "@soleone/showcase/capture";

const exec = promisify(execFile);
const media = path.resolve("demo/media");
const viewport = { width: 1280, height: 820 };
// The hint buttons and the terminal, below the page title. The hero is the bottom of the terminal, the ◆ topic line included.
const crop = "iw:ih*625/820:0:ih*125/820";
const heroCrop = "iw:ih*330/820:0:ih*400/820";
const click = (hint) => `[...document.querySelectorAll('#hints button')].find((button) => button.textContent === ${JSON.stringify(hint)}).click()`;
const shows = (text) => `window.terminalText().includes(${JSON.stringify(text)})`;

await exec("node", ["demo/browser/build.mjs"]);
const out = await mkdtemp(path.join(os.tmpdir(), "pi-topic-demo-"));
const port = String(4400 + (process.pid % 500));
const server = spawn("node_modules/.bin/showcase", ["terminal", "demo/browser", "--out", path.join(out, "browser"), "--serve", "--port", port], {
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve, reject) => {
  createInterface({ input: server.stdout }).on("line", (line) => line.startsWith("Serving at") && resolve());
  server.once("exit", (code) => reject(new Error(`showcase terminal exited with status ${code}`)));
});
const shot = path.join(out, "last.png");
try {
  const { frames, durationMs, grid } = await record({
    url: `http://127.0.0.1:${port}/`,
    out: path.join(media, "demo.webp"),
    viewport,
    width: 1100,
    crop,
    attempts: 3,
    async start(page) {
      await page.waitFor("window.demoReady === true", { timeoutMs: 120_000 });
      // The recipe starts pi by itself.
      await page.waitFor(shows("scripted • "), { timeoutMs: 60_000 });
      await page.sleep(1500);
    },
    async drive(page) {
      await page.sleep(1200);
      await page.run("eval", click("the forecast for new york is missing"));
      // The ◆ line first shows the prompt itself, then the model's topic.
      await page.waitFor(shows("◆ the forecast for new york is missing"), { timeoutMs: 30_000 });
      await page.waitFor(shows("◆ Forecast sample data: adding New York"), { timeoutMs: 30_000 });
      await page.waitFor(shows("works now"), { timeoutMs: 60_000 });
      await page.sleep(2000);
      await page.run("eval", click("add a --json flag"));
      await page.waitFor(shows("◆ add a --json flag"), { timeoutMs: 30_000 });
      await page.waitFor(shows("◆ Forecast CLI: machine-readable JSON output"), { timeoutMs: 30_000 });
      await page.waitFor(shows("plain output is unchanged"), { timeoutMs: 60_000 });
      await page.sleep(3000);
      await page.run("screenshot", shot);
    },
  });
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", shot, "-vf", `crop=${heroCrop}`, path.join(media, "hero.png")]);
  console.log(`Wrote demo/media/demo.webp (${frames} frames, ${(durationMs / 1000).toFixed(1)} s) and demo/media/hero.png. Check the frames in ${grid}.`);
} finally {
  server.kill();
  await rm(out, { recursive: true, force: true });
}
