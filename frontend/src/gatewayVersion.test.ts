import assert from "node:assert/strict";
import { test } from "node:test";
import { VERSION_HEADER, versionMismatch } from "./gatewayVersion.ts";

const answer = (version?: string) =>
  new Response("[]", {
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
