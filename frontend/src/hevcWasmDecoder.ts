// EXPERIMENTAL: a software decoder for a High Performance Mac's passed HEVC, for a
// browser whose `VideoDecoder` does not take it (appleMedia.ts decides).
//
// libavcodec's HEVC decoder compiled to WebAssembly (andrewtheguy/hevc-wasm), with
// its SIMD128 kernels and its slice threads, running in a worker of its own beside
// the paint worker: a picture takes tens of milliseconds of CPU, and the paint
// worker has to go on answering a `clear` while one does.
//
// It is shaped as a `VideoDecoder` — configure, decode, close, an output and an
// error callback — so `createVideoStream` (videoDecoder.ts) runs it exactly as it
// runs the browser's: the same keyframe gate, the same FIFO of promises, the same
// stall backstop. Unlike a `VideoDecoder`, it keeps the pairing that stream only
// hopes for: the decode worker answers every unit with one picture or with none,
// and a none is `noPicture`, which settles that unit's entry to null rather than
// leaving it for the next picture to resolve.

/** What the paint worker sends the decode worker. */
export type HevcCommand =
  | { type: "create"; id: number }
  | {
      type: "decode";
      id: number;
      data: ArrayBuffer;
      keyframe: boolean;
      timestamp: number;
    }
  | { type: "destroy"; id: number };

/** What the decode worker answers: one `decoded` or `failed` per `decode`. */
export type HevcEvent =
  | { type: "decoded"; id: number; frame: VideoFrame | null }
  /**
   * The decoder is over. `name` follows WebCodecs: `NotSupportedError` for a
   * module or a picture this browser cannot run at all, `EncodingError` for a unit
   * that failed to decode.
   */
  | { type: "failed"; id: number; name: string; message: string };

/** What `createVideoStream` builds a decoder with. */
export interface VideoDecoderLikeInit extends VideoDecoderInit {
  /**
   * A unit decoded to no picture. Only a decoder that answers every unit calls it;
   * `VideoDecoder` never does.
   */
  noPicture?: () => void;
}

/** The part of `VideoDecoder` that `createVideoStream` uses. */
export interface VideoDecoderLike {
  readonly state: CodecState;
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  close(): void;
}

interface Client {
  onEvent: (event: HevcEvent) => void;
}

// One decode worker for the paint worker's lifetime, started by the first HEVC
// stream: loading the module compiles it and starts its threads, which a resize
// should not pay for again. Each stream is a decoder of its own inside it.
let worker: Worker | null = null;
const clients = new Map<number, Client>();
let nextId = 1;

function decodeWorker(): Worker {
  if (worker) {
    return worker;
  }
  const started = new Worker(new URL("./hevcWasm.worker.ts", import.meta.url), {
    type: "module",
    name: "hevc-decoder",
  });
  started.onmessage = (ev: MessageEvent<HevcEvent>) => {
    const event = ev.data;
    const client = clients.get(event.id);
    if (client) {
      client.onEvent(event);
    } else if (event.type === "decoded") {
      // A stream closed while this was on its way.
      event.frame?.close();
    }
  };
  started.onerror = (ev) => {
    // A worker that failed to start takes every decoder in it down.
    ev.preventDefault();
    worker = null;
    for (const [id, client] of clients) {
      client.onEvent({
        type: "failed",
        id,
        name: "NotSupportedError",
        message: `the HEVC decoder's worker failed (${ev.message || "no message"})`,
      });
    }
    started.terminate();
  };
  worker = started;
  return started;
}

/** Whether a configuration string names HEVC. */
export function isHevc(codec: string): boolean {
  return codec.startsWith("hev1.") || codec.startsWith("hvc1.");
}

/** A `VideoDecoder` for HEVC, decoding in the decode worker. */
export function createWasmHevcDecoder(
  init: VideoDecoderLikeInit,
): VideoDecoderLike {
  const id = nextId++;
  let state: CodecState = "unconfigured";

  const fail = (name: string, message: string) => {
    if (state === "closed") {
      return;
    }
    close();
    const error = new Error(message);
    error.name = name;
    init.error(error as DOMException);
  };

  const close = () => {
    if (state === "closed") {
      return;
    }
    const configured = state === "configured";
    state = "closed";
    clients.delete(id);
    if (configured) {
      worker?.postMessage({ type: "destroy", id } satisfies HevcCommand);
    }
  };

  return {
    get state() {
      return state;
    },
    configure(config) {
      if (state === "closed") {
        throw new DOMException(
          "configure on a closed decoder",
          "InvalidStateError",
        );
      }
      if (!isHevc(config.codec)) {
        // Asynchronously, as `VideoDecoder` reports a refused configuration.
        queueMicrotask(() =>
          fail(
            "NotSupportedError",
            `not an HEVC configuration: ${config.codec}`,
          ),
        );
        return;
      }
      state = "configured";
      clients.set(id, {
        onEvent: (event) => {
          if (event.type === "failed") {
            fail(event.name, event.message);
          } else if (state !== "configured") {
            event.frame?.close();
          } else if (event.frame) {
            init.output(event.frame);
          } else {
            init.noPicture?.();
          }
        },
      });
      decodeWorker().postMessage({ type: "create", id } satisfies HevcCommand);
    },
    decode(chunk) {
      if (state !== "configured") {
        throw new DOMException(
          "decode on a decoder not configured",
          "InvalidStateError",
        );
      }
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      decodeWorker().postMessage(
        {
          type: "decode",
          id,
          data,
          keyframe: chunk.type === "key",
          timestamp: chunk.timestamp,
        } satisfies HevcCommand,
        [data],
      );
    },
    close,
  };
}
