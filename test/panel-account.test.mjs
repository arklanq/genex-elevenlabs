import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setImmediate as settle, setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";

const PANEL = new URL("../plugin/panel.html", import.meta.url);

/** Just enough of an element for the panel script. */
function element() {
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    dataset: {},
    style: { setProperty() {} },
    setAttribute() {},
    removeAttribute() {},
    replaceChildren() {},
    append() {},
    remove() {},
    focus() {},
    click() {
      return this.onclick?.();
    },
  };
}

/**
 * Run the panel's own script against a fake page and a fake host. Like Studio, the host announces
 * every account action to the panel once more after the action answered.
 */
async function openPanel(answers) {
  const html = await readFile(PANEL, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Set();
  const document = {
    body: element(),
    documentElement: element(),
    createElement: element,
    getElementById: (id) => elements.get(id) ?? elements.set(id, element()).get(id),
  };
  const studioPlugin = {
    async call(kind, name, args) {
      if (kind === "context") return { theme: {} };
      if (name !== "status") setTimeout(() => listeners.forEach((listener) => listener()));
      return answers[name](args);
    },
    onContextChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const window = { studioPlugin, addEventListener() {} };
  const getComputedStyle = () => ({ color: "rgb(60, 68, 196)" });
  runInNewContext(scripts.at(-1), { window, document, getComputedStyle, Intl, Error, String, Number, setTimeout });
  await settle();
  return document.getElementById.bind(document);
}

async function untilSettled() {
  for (let i = 0; i < 10; i++) await settle();
  await delay(0);
  for (let i = 0; i < 10; i++) await settle();
}

test("using a saved key that is not there keeps the error on screen", async () => {
  const $ = await openPanel({
    status: () => ({ connected: false }),
    connect: () => ({ connected: false, needsKey: true }),
  });
  $("unlock").click();
  await untilSettled();
  assert.notEqual($("error").textContent, "");
});

test("a key the service refuses keeps its error on screen", async () => {
  const $ = await openPanel({
    status: () => ({ connected: false }),
    connect: () => {
      throw new Error("Invalid API key");
    },
  });
  $("key").value = "bad-key";
  $("save").click();
  await untilSettled();
  assert.equal($("error").textContent, "Invalid API key");
});

test("the next action clears the previous error", async () => {
  let saved = false;
  const $ = await openPanel({
    status: () => ({ connected: saved }),
    connect: () => {
      saved = true;
      return { connected: true };
    },
  });
  $("save").click();
  await untilSettled();
  assert.notEqual($("error").textContent, "");
  $("unlock").click();
  await untilSettled();
  assert.equal($("error").textContent, "");
  assert.equal($("key-form").hidden, true);
});
