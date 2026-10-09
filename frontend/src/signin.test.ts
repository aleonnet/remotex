// Which of the catalogue's causes a failed sign-in is.
import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal, unanswered } from "./signin.ts";
import { say } from "./words.ts";

test("401 is wrong credentials, and says nothing of which field", () => {
  assert.deepEqual(refusal(401), { cause: "AL-1201" });
});

test("any other answer is the gateway refusing, said with its status", () => {
  for (const status of [400, 403, 500, 502, 503]) {
    const failure = refusal(status);
    assert.deepEqual(failure, { cause: "AL-1202", fill: { status } });
    assert.match(
      say("en-US", failure.cause, failure.fill),
      new RegExp(`\\(answer ${status}\\)`),
    );
  }
});

test("a request nothing answered is the gateway out of reach, with what the browser said", () => {
  assert.deepEqual(unanswered(new TypeError("Failed to fetch")), {
    cause: "AL-1203",
    detail: "Failed to fetch",
  });
  // Something thrown that is no error has nothing to say.
  assert.deepEqual(unanswered("boom"), { cause: "AL-1203" });
});
