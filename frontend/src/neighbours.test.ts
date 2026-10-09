import assert from "node:assert/strict";
import { test } from "node:test";
import { neighbours, neighboursOf } from "./neighbours.ts";

const ANA = {
  name: "MacBook da Ana",
  url: "https://macbook-da-ana.example.ts.net",
};
const MINI = {
  name: "Mac mini da sala",
  url: "https://mac-mini.example.ts.net/",
};

const answer = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    }),
  );

test("a computer with a name and an https address is a neighbour", () => {
  assert.deepEqual(neighboursOf([ANA, MINI]), [ANA, MINI]);
});

test("an address that is not https is never a line, whatever the gateway said", () => {
  const said = [
    { name: "sem cadeado", url: "http://mini.example.ts.net" },
    { name: "outra coisa", url: "javascript:alert(1)" },
    { name: "um arquivo", url: "file:///etc/passwd" },
    { name: "sem endereço", url: "" },
    { name: "relativo", url: "/api/targets" },
    { name: "maiúsculas", url: "HTTP://mini.example.ts.net" },
    { name: "não é texto", url: 443 },
    ANA,
  ];
  assert.deepEqual(neighboursOf(said), [ANA]);
});

test("a neighbour with no name is left out", () => {
  const said = [
    { name: "", url: ANA.url },
    { name: "   ", url: ANA.url },
    { url: ANA.url },
    { name: 7, url: ANA.url },
    null,
    "MacBook",
    MINI,
  ];
  assert.deepEqual(neighboursOf(said), [MINI]);
});

test("nothing more than the name and the address is carried", () => {
  const said = [{ ...ANA, password: "x", html: "<b>Ana</b>" }];
  assert.deepEqual(neighboursOf(said), [ANA]);
});

test("an answer that is not a list has no neighbours", () => {
  for (const said of [null, undefined, {}, { neighbours: [ANA] }, "[]", 3]) {
    assert.deepEqual(neighboursOf(said), []);
  }
});

test("the gateway's list is what is asked for", async () => {
  assert.deepEqual(await neighbours(() => answer([ANA, MINI])), [ANA, MINI]);
  assert.deepEqual(await neighbours(() => answer([])), []);
});

test("asking that fails is no neighbours, and never an error", async () => {
  // Refused, missing on a gateway that has no such route, or broken.
  for (const status of [401, 404, 500, 502]) {
    assert.deepEqual(await neighbours(() => answer([ANA], status)), []);
  }
  // Something that is not JSON, and a network that did not answer.
  assert.deepEqual(await neighbours(() => answer("<html>gateway</html>")), []);
  assert.deepEqual(
    await neighbours(() => Promise.reject(new TypeError("Failed to fetch"))),
    [],
  );
  assert.deepEqual(
    await neighbours(() => {
      throw new Error("no network at all");
    }),
    [],
  );
});
