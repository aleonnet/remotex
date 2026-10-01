// Whether this page composes a passed RDP pipeline: a yes needs both a memory its
// threads can share and a WebGL 2 canvas off the page, and anything else, a page
// that throws included, is a no.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  composesRdpGraphics,
  resetRdpGraphicsForTests,
} from "./rdpGraphics.ts";

const page = globalThis as unknown as {
  crossOriginIsolated?: boolean;
  OffscreenCanvas?: unknown;
};
const original = {
  crossOriginIsolated: page.crossOriginIsolated,
  OffscreenCanvas: page.OffscreenCanvas,
};

/** A page that is isolated or not, whose off-page canvas gives `context`. */
function pageWith(isolated: boolean, context: () => unknown): void {
  resetRdpGraphicsForTests();
  page.crossOriginIsolated = isolated;
  page.OffscreenCanvas = class {
    getContext(kind: string) {
      assert.equal(kind, "webgl2");
      return context();
    }
  };
}

const webgl2 = () => ({ isContextLost: () => false, getExtension: () => null });

afterEach(() => {
  page.crossOriginIsolated = original.crossOriginIsolated;
  page.OffscreenCanvas = original.OffscreenCanvas;
  resetRdpGraphicsForTests();
});

test("an isolated page with WebGL 2 composes the pipeline", () => {
  pageWith(true, webgl2);
  assert.equal(composesRdpGraphics(), true);
});

test("a page that is not cross-origin isolated does not", () => {
  pageWith(false, webgl2);
  assert.equal(composesRdpGraphics(), false);
});

test("nor one without WebGL 2, or whose context is lost", () => {
  pageWith(true, () => null);
  assert.equal(composesRdpGraphics(), false);
  pageWith(true, () => ({ isContextLost: () => true }));
  assert.equal(composesRdpGraphics(), false);
});

test("a page that throws reads as no, and the answer is asked once", () => {
  let asked = 0;
  pageWith(true, () => {
    asked += 1;
    throw new Error("no GPU process");
  });
  assert.equal(composesRdpGraphics(), false);
  assert.equal(composesRdpGraphics(), false);
  assert.equal(asked, 1);
});
