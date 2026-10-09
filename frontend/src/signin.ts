// Why a sign-in did not go through, as the error catalogue names it.
//
// Three causes, and the page tells them apart because each has something else to
// do about it: the credentials were wrong, the gateway answered something other
// than yes or no, or nothing answered at all. A module of its own so the rule is
// tested without a browser.

import type { Code, Fill } from "./words.ts";

/** A cause of a failed sign-in, and what fills its text. */
export interface SigninFailure {
  cause: Code;
  fill?: Fill;
  /** What the browser said of it, as it said it. */
  detail?: string;
}

/**
 * The failure an answer that is not a yes stands for. 401 is the gateway's "no":
 * it does not say which of the two fields was wrong, and neither does the page.
 * Anything else is the gateway, or a proxy in front of it, failing to answer the
 * question, and is said with its status.
 */
export function refusal(status: number): SigninFailure {
  return status === 401
    ? { cause: "AL-1201" }
    : { cause: "AL-1202", fill: { status } };
}

/**
 * The request never got an answer: the gateway is down, or out of reach. What
 * `fetch` rejected with goes beside it: it rejects for a request that never left
 * as well as for one that did, and its own message tells the two apart.
 */
export function unanswered(thrown: unknown): SigninFailure {
  return thrown instanceof Error
    ? { cause: "AL-1203", detail: thrown.message }
    : { cause: "AL-1203" };
}
