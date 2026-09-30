// EXPERIMENTAL: the decode worker behind hevcWasmDecoder.ts. It loads libavcodec's
// HEVC decoder (andrewtheguy/hevc-wasm, which the gateway serves at /hevc/) once,
// runs one decoder per stream the paint worker opens, and answers every unit with
// one picture or none.
//
// A picture leaves as a `VideoFrame` built straight over the decoder's planes in
// linear memory — the constructor's copy is the only one — and is transferred to
// the paint worker, which draws it as it draws the browser's own.

import { hevcDecoderUrl } from "./gateway.ts";
import type { HevcCommand, HevcEvent } from "./hevcWasmDecoder.ts";

/** The module hevc-wasm's src/decoder.c builds, as its glue exposes it. */
interface HevcModule {
  _hevc_create(threads: number): number;
  _hevc_input(decoder: number, size: number): number;
  _hevc_decode(decoder: number, keyframe: number): number;
  _hevc_picture(decoder: number): number;
  _hevc_destroy(decoder: number): void;
  wasmMemory: WebAssembly.Memory;
}

type CreateModule = (options: {
  threads: number;
  locateFile: (path: string) => string;
}) => Promise<HevcModule>;

const scope = self as unknown as {
  postMessage(message: HevcEvent, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<HevcCommand>) => void) | null;
};

// The decoder's slice threads, each a worker the module starts before it resolves.
// Rows of a picture decode in parallel under wavefront parallel processing, and
// past eight a 3200×2000 picture was measured gaining nothing more.
const THREADS = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));

let loading: Promise<HevcModule> | null = null;

function load(): Promise<HevcModule> {
  loading ??= (async () => {
    const { default: create } = (await import(
      /* @vite-ignore */ hevcDecoderUrl("hevc.js")
    )) as { default: CreateModule };
    return create({
      threads: THREADS,
      locateFile: (path) =>
        path.endsWith(".wasm") ? hevcDecoderUrl("hevc.wasm") : path,
    });
  })();
  return loading;
}

// FFmpeg's enums (libavutil/pixfmt.h) as WebCodecs names them; anything else is
// left unstated, as a decoder states nothing the stream does not. Strings, since
// TypeScript's DOM library lists fewer than browsers take — the Mac's Display P3
// primaries, `smpte432`, among them.
const MATRIX: Record<number, string> = {
  0: "rgb",
  1: "bt709",
  5: "bt470bg",
  6: "smpte170m",
  9: "bt2020-ncl",
};
const PRIMARIES: Record<number, string> = {
  1: "bt709",
  5: "bt470bg",
  6: "smpte170m",
  9: "bt2020",
  12: "smpte432",
};
const TRANSFER: Record<number, string> = {
  1: "bt709",
  6: "smpte170m",
  8: "linear",
  13: "iec61966-2-1",
  16: "pq",
  18: "hlg",
};
const FORMATS: VideoPixelFormat[] = ["I420", "I422", "I444"];

// Whether a `VideoFrame` may be built over shared memory. The specification takes
// any buffer; a browser that refuses a shared one is given a copy, found once.
let sharedViews = true;

/** The picture `_hevc_decode` just returned, as a `VideoFrame`. */
function picture(
  module: HevcModule,
  decoder: number,
  timestamp: number,
): VideoFrame | string {
  const memory = module.wasmMemory.buffer;
  const p = new Int32Array(memory, module._hevc_picture(decoder), 16);
  const [w, h, layout, range, matrix, primaries, transfer] = p;
  const format = FORMATS[layout];
  if (!format) {
    return "the stream's pictures are not 8-bit Y'CbCr, which a VideoFrame holds";
  }
  const chromaW = layout === 2 ? w : (w + 1) >> 1;
  const chromaH = layout === 0 ? (h + 1) >> 1 : h;
  const planes = [0, 1, 2].map((i) => ({
    at: p[7 + i],
    stride: p[10 + i],
    width: i === 0 ? w : chromaW,
    rows: i === 0 ? h : chromaH,
  }));
  const start = Math.min(...planes.map((plane) => plane.at));
  const end = Math.max(
    ...planes.map(
      (plane) => plane.at + plane.stride * (plane.rows - 1) + plane.width,
    ),
  );
  const init: VideoFrameBufferInit = {
    format,
    codedWidth: w,
    codedHeight: h,
    timestamp,
    layout: planes.map((plane) => ({
      offset: plane.at - start,
      stride: plane.stride,
    })),
    colorSpace: {
      fullRange: range === 2 ? true : range === 1 ? false : undefined,
      matrix: MATRIX[matrix],
      primaries: PRIMARIES[primaries],
      transfer: TRANSFER[transfer],
    } as VideoColorSpaceInit,
  };
  const bytes = new Uint8Array(memory, start, end - start);
  if (sharedViews) {
    try {
      return new VideoFrame(bytes, init);
    } catch (e) {
      if (!(e instanceof TypeError)) {
        throw e;
      }
      sharedViews = false;
    }
  }
  return new VideoFrame(bytes.slice(), init);
}

const decoders = new Map<number, number>();

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function failed(id: number, name: string, message: string) {
  scope.postMessage({ type: "failed", id, name, message });
}

async function create(id: number): Promise<void> {
  let module: HevcModule;
  try {
    module = await load();
  } catch (e) {
    failed(
      id,
      "NotSupportedError",
      `the HEVC decoder did not load (${reason(e)})`,
    );
    return;
  }
  const decoder = module._hevc_create(THREADS);
  if (!decoder) {
    failed(id, "NotSupportedError", "the HEVC decoder did not open");
    return;
  }
  decoders.set(id, decoder);
}

async function destroy(id: number): Promise<void> {
  const decoder = decoders.get(id);
  decoders.delete(id);
  if (decoder) {
    (await load())._hevc_destroy(decoder);
  }
}

async function decode(
  command: Extract<HevcCommand, { type: "decode" }>,
): Promise<void> {
  const { id } = command;
  const decoder = decoders.get(id);
  if (!decoder) {
    // Its create failed, and said so; or this worker is not the one it was
    // created in.
    failed(id, "EncodingError", "no HEVC decoder for this stream");
    return;
  }
  const module = await load();
  const fail = (name: string, message: string) => {
    decoders.delete(id);
    module._hevc_destroy(decoder);
    failed(id, name, message);
  };
  const size = command.data.byteLength;
  const input = module._hevc_input(decoder, size);
  if (!input) {
    fail("EncodingError", "the HEVC decoder is out of memory");
    return;
  }
  new Uint8Array(module.wasmMemory.buffer, input, size).set(
    new Uint8Array(command.data),
  );
  const ret = module._hevc_decode(decoder, command.keyframe ? 1 : 0);
  if (ret < 0) {
    fail("EncodingError", `libavcodec failed to decode a unit (error ${ret})`);
    return;
  }
  if (ret === 0) {
    scope.postMessage({ type: "decoded", id, frame: null });
    return;
  }
  const frame = picture(module, decoder, command.timestamp);
  if (typeof frame === "string") {
    fail("NotSupportedError", frame);
    return;
  }
  scope.postMessage({ type: "decoded", id, frame }, [frame]);
}

function handle(command: HevcCommand): Promise<void> {
  switch (command.type) {
    case "create":
      return create(command.id);
    case "destroy":
      return destroy(command.id);
    case "decode":
      return decode(command);
  }
}

// One command at a time, in order: a decode that arrives while the module loads
// waits behind its create.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (ev) => {
  const command = ev.data;
  queue = queue.then(() =>
    handle(command).catch((e) => {
      // Every decode is answered, a thrown one included.
      if (command.type === "decode") {
        failed(
          command.id,
          "EncodingError",
          `the HEVC decoder failed (${reason(e)})`,
        );
      }
    }),
  );
};
