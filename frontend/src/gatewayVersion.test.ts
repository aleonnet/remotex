import assert from "node:assert/strict";
import { test } from "node:test";
import { VERSION_HEADER, versionMismatch } from "./gatewayVersion.ts";

const answer = (version?: string, status = 200) =>
  new Response("[]", {
    status,
    headers: version === undefined ? {} : { [VERSION_HEADER]: version },
  });

test("a gateway of this page's version is its own", () => {
  assert.equal(versionMismatch(answer("0.0.308"), "0.0.308"), null);
});

test("a gateway of another version is named beside the page's", () => {
  assert.equal(
    versionMismatch(answer("0.0.309"), "0.0.308"),
    "This page is v0.0.308 and the gateway is v0.0.309. Reload the page.",
  );
});

test("an answer that states no version is a mismatch too", () => {
  assert.equal(
    versionMismatch(answer(), "0.0.308"),
    "This page is v0.0.308 and the gateway did not state its version. Reload the page.",
  );
});

test("the gateway's refusals are held to the version as well", () => {
  for (const status of [401, 409]) {
    assert.notEqual(
      versionMismatch(answer("0.0.309", status), "0.0.308"),
      null,
    );
    assert.equal(versionMismatch(answer("0.0.308", status), "0.0.308"), null);
  }
});

test("a status that may be a proxy's is not judged", () => {
  assert.equal(versionMismatch(answer(undefined, 502), "0.0.308"), null);
});
