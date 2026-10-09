// One thread of the compositor's pool (egfxCompositor.ts): an instance of the
// module on the memory the paint worker's instance has, which takes a seat in the
// pool and decodes what the pool hands it.
//
// It answers once, before it takes its seat: null when its instance is made, or
// why it could not be. Taking the seat does not return, so nothing is heard from
// it after.
import init, { runPoolThread } from "../wasm/egfx/pkg/alumia_egfx.js";

/** What the paint worker's instance is, for this one to be of the same. */
export interface PoolSeat {
  module: WebAssembly.Module;
  memory: WebAssembly.Memory;
}

// The DOM lib types `self` as a Window; see desktopPainter.worker.ts.
const scope = self as unknown as {
  postMessage(message: string | null): void;
  onmessage: ((ev: MessageEvent<PoolSeat>) => void) | null;
};

scope.onmessage = ({ data }) => {
  init({ module_or_path: data.module, memory: data.memory }).then(
    () => {
      scope.postMessage(null);
      runPoolThread();
    },
    (error: unknown) => {
      scope.postMessage(error instanceof Error ? error.message : String(error));
    },
  );
};
