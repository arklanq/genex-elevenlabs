import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script } from "node:vm";

const PANEL = new URL("../plugin/panel.html", import.meta.url);

test("every inline panel script parses", async () => {
  const html = await readFile(PANEL, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0, "the panel has inline scripts");
  // A syntax error stops the whole script, so the panel never leaves its spinner.
  for (const source of scripts) assert.doesNotThrow(() => new Script(source));
});
