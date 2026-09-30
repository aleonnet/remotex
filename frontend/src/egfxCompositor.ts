// The page's compositor for an RDP host's graphics pipeline.
//
// On a target with `egfx_passthrough` the gateway does not compose the desktop and
// encode it: it passes the host's drawing commands on, and this page composes them.
// What does the composing is the gateway's own compositor and codecs, compiled to
// WebAssembly (frontend/wasm/egfx, around the crate the gateway composes with), so
// there is one reading of the protocol and not two.
//
// A compositor is right only for a pipeline it has followed from its first
// command: the host draws against what its client already holds — surfaces, cache
// slots, each codec's own caches. So one is made at every `graphicsStart` and never
// carried past the next, and one that has refused a command is not fed again.
//
// Progressive's tiles are decoded side by side, on threads: workers this one
// starts, each an instance of the module on the one memory (egfxPool.worker.ts).
// A memory that is shared needs a page that is cross-origin isolated, which the
// gateway's two headers make of every page it serves (src/assets.rs).
//
// The framebuffer stays in the module's memory, and a canvas takes no image data
// out of a shared one. So the compositor keeps the picture a second time, in a
// memory of its own, and copies into it the rectangles each run painted: `pixels`
// is that copy, good until the next `compose` that resets the output.
import init, {
  module as compiled,
  Egfx,
  type InitInput,
  startPool,
} from "../wasm/egfx/pkg/remotex_egfx.js";
import type { PoolSeat } from "./egfxPool.worker.ts";

/**
 * The most threads the tiles are decoded on. Past four the captured desktop this
 * was measured with composed no sooner: what is left is what one thread does.
 */
const MOST_THREADS = 4;

/** What one run of commands did to the picture. */
export interface ComposedRun {
  /** The rectangles the run painted: `x, y, width, height` for each. */
  painted: Uint32Array;
  /** The framebuffer's size, in its own pixels. Zero before the first reset. */
  width: number;
  height: number;
  /** The whole picture, RGBA, top row first. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

export interface EgfxCompositor {
  /**
   * Compose one GRAPHICS record's commands. Throws for a command that does not
   * decode, after which this compositor is no longer the host's picture of its
   * client.
   */
  compose(commands: Uint8Array): ComposedRun;
  /** Give the compositor's memory back. */
  close(): void;
}

/** Makes a compositor with nothing in it, for a pipeline that is starting. */
export type EgfxFactory = () => EgfxCompositor;

let loaded: Promise<EgfxFactory> | null = null;

/** The pool's workers, held for as long as the pool is: the page's lifetime. */
const workers: Worker[] = [];

/**
 * Start the pool: `threads` workers, each told what this instance is and heard
 * from once its own is made, and then the pool made of them. The pool is made last
 * because making it waits for its threads, and a worker does not start while the
 * one that made it waits.
 */
async function startThreads(
  memory: WebAssembly.Memory,
  threads: number,
): Promise<void> {
  const seat: PoolSeat = { module: compiled(), memory };
  try {
    await Promise.all(
      Array.from(
        { length: threads },
        () =>
          new Promise<void>((resolve, reject) => {
            const worker = new Worker(
              new URL("./egfxPool.worker.ts", import.meta.url),
              { type: "module", name: "egfx-pool" },
            );
            workers.push(worker);
            worker.onmessage = ({ data }: MessageEvent<string | null>) => {
              if (data === null) {
                resolve();
              } else {
                reject(new Error(data));
              }
            };
            worker.onerror = (event) => {
              reject(new Error(event.message || "a thread did not start"));
            };
            // Throws for a memory that cannot be shared, which is a page that is
            // not cross-origin isolated.
            worker.postMessage(seat);
          }),
      ),
    );
  } catch (error) {
    for (const worker of workers.splice(0)) {
      worker.terminate();
    }
    throw error;
  }
  startPool(threads);
}

/** A framebuffer's rectangle, copied row by row into the same place in `to`. */
function copyRect(
  from: Uint8ClampedArray,
  to: Uint8ClampedArray,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  for (let row = y; row < y + height; row += 1) {
    const at = row * stride + x * 4;
    to.set(from.subarray(at, at + width * 4), at);
  }
}

/**
 * The module, fetched and compiled once for the page, its threads started, and
 * what makes compositors out of it. `source` is the module's bytes for a runtime
 * with nothing to fetch from, which is a test; so is a `threads` of zero, for one
 * with no workers to start, where the module composes on the thread that calls it.
 */
export function loadEgfx(
  source?: InitInput,
  threads = Math.min(navigator.hardwareConcurrency, MOST_THREADS),
): Promise<EgfxFactory> {
  loaded ??= init(source === undefined ? undefined : { module_or_path: source })
    .then(async ({ memory }) => {
      if (threads > 0) {
        await startThreads(memory, threads);
      }
      return () => {
        const egfx = new Egfx();
        let pixels = new Uint8ClampedArray(0);
        return {
          compose(commands: Uint8Array): ComposedRun {
            egfx.compose(commands);
            const width = egfx.width();
            const height = egfx.height();
            const bytes = width * height * 4;
            if (egfx.resized() || pixels.length !== bytes) {
              pixels = new Uint8ClampedArray(bytes);
            }
            const painted = egfx.painted();
            const shared = new Uint8ClampedArray(
              memory.buffer,
              egfx.pixels(),
              bytes,
            );
            for (let i = 0; i + 3 < painted.length; i += 4) {
              copyRect(
                shared,
                pixels,
                width * 4,
                painted[i],
                painted[i + 1],
                painted[i + 2],
                painted[i + 3],
              );
            }
            return { painted, width, height, pixels };
          },
          close() {
            egfx.free();
          },
        };
      };
    })
    .catch((error: unknown) => {
      // A load that failed is tried again by the next pipeline: the page may have
      // been offline for the one fetch, and nothing else would ever retry it.
      loaded = null;
      throw error;
    });
  return loaded;
}
