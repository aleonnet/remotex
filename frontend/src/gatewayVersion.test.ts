import assert from "node:assert/strict";
import { test } from "node:test";
import { VERSION_HEADER, versionDifference } from "./gatewayVersion.ts";

const answer = (version?: string, status = 200) =>
  new Response("[]", {
    status,
    headers: version === undefined ? {} : { [VERSION_HEADER]: version },
  });

test("a gateway of this page's version is its own", () => {
  assert.equal(versionDifference(answer("0.0.308"), "0.0.308"), null);
});

test("a gateway of another version is named beside the page's", () => {
  assert.deepEqual(versionDifference(answer("0.0.309"), "0.0.308"), {
    page: "0.0.308",
    gateway: "0.0.309",
  });
});

test("an answer that states no version is a mismatch too, with none to give", () => {
  assert.deepEqual(versionDifference(answer(), "0.0.308"), {
    page: "0.0.308",
    gateway: null,
  });
});

test("the gateway's refusals are held to the version as well", () => {
  for (const status of [401, 409]) {
    assert.notEqual(
      versionDifference(answer("0.0.309", status), "0.0.308"),
      null,
    );
    assert.equal(versionDifference(answer("0.0.308", status), "0.0.308"), null);
  }
});

test("a status that may be a proxy's is not judged", () => {
  assert.equal(versionDifference(answer(undefined, 502), "0.0.308"), null);
});
