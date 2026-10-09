// The other computers with Alumia, which the list of computers shows after its
// own.
//
// A gateway a Mac app hosts finds them (`GET /api/neighbours`), each by the name
// that computer gives itself and the address of its own Alumia. A line of one is
// a way to that address and nothing else: this gateway holds no credential of
// another's, so opening one is leaving for it, where it asks for its own login.
//
// Two things follow. An address is a place this window is sent to, so only an
// `https` one is ever a line, whatever the gateway said. And the list of computers
// is the gateway's own answer, which this one is beside: whatever goes wrong with
// asking for neighbours is no neighbours, and the list is shown as it would be
// without them.
import { gatewayFetch } from "./gateway.ts";

/** Another computer with Alumia. */
export interface Neighbour {
  /** What that computer calls itself. */
  name: string;
  /** Where its own Alumia is. */
  url: string;
}

/** `url` where it is an `https` address a browser reads as one, else `null`. */
function secure(url: unknown): string | null {
  if (typeof url !== "string") {
    return null;
  }
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The neighbours in `said`, a gateway's answer, that a line may be made of: each
 * with a name and an `https` address. Anything else in it is left out, and an
 * answer that is not a list has none.
 */
export function neighboursOf(said: unknown): Neighbour[] {
  if (!Array.isArray(said)) {
    return [];
  }
  const found: Neighbour[] = [];
  for (const entry of said as unknown[]) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { name, url } = entry as Record<string, unknown>;
    const address = secure(url);
    if (typeof name === "string" && name.trim() !== "" && address !== null) {
      found.push({ name, url: address });
    }
  }
  return found;
}

/**
 * The neighbours the gateway lists, and none where it lists none, refuses, does
 * not answer or answers something else. Never rejects.
 */
export async function neighbours(
  ask: () => Promise<Response> = () => gatewayFetch("/api/neighbours"),
): Promise<Neighbour[]> {
  try {
    const answer = await ask();
    return answer.ok ? neighboursOf(await answer.json()) : [];
  } catch {
    return [];
  }
}
