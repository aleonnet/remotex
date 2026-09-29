// The page's compositor for an RDP host's graphics pipeline.
//
// On a target with `egfx_passthrough` the gateway does not compose the desktop and
// encode it: it passes the host's drawing commands on, and this page composes them.
// What does the composing is the gateway's own compositor and codecs, compiled to
// WebAssembly (frontend/wasm/egfx, whose sources are the gateway's by path), so
// there is one reading of the protocol and not two.
//
// A compositor is right only for a pipeline it has followed from its first
// command: the host draws against what its client already holds — surfaces, cache
// slots, each codec's own caches. So one is made at every `graphicsStart` and never
// carried past the next, and one that has refused a command is not fed again.
//
// The framebuffer stays in the module's memory and is read in place. `pixels` is a
// view of it, good until the next `compose`: that call may move the framebuffer or
// grow the memory, either of which leaves an earlier view looking at nothing.
import init, { Egfx, type InitInput } from "../wasm/egfx/pkg/remotex_egfx.js";

/** What one run of commands did to the picture. */
export interface ComposedRun {
  /** The rectangles the run painted: `x, y, width, height` for each. */
  painted: Uint32Array;
  /** The framebuffer's size, in its own pixels. Zero before the first reset. */
  width: number;
  height: number;
  /** The whole framebuffer, RGBA, top row first. */
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

/**
 * The module, fetched and compiled once for the page, and what makes compositors
 * out of it. `source` is the module's bytes for a runtime with nothing to fetch
 * from, which is a test.
 */
export function loadEgfx(source?: InitInput): Promise<EgfxFactory> {
  loaded ??= init(source === undefined ? undefined : { module_or_path: source })
    .then(({ memory }) => () => {
      const egfx = new Egfx();
      return {
        compose(commands: Uint8Array): ComposedRun {
          egfx.compose(commands);
          const width = egfx.width();
          const height = egfx.height();
          return {
            painted: egfx.painted(),
            width,
            height,
            pixels: new Uint8ClampedArray(
              memory.buffer as ArrayBuffer,
              egfx.pixels(),
              width * height * 4,
            ),
          };
        },
        close() {
          egfx.free();
        },
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
