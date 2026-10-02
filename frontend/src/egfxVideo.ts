// The H.264 decoders of a passed RDP pipeline: EXPERIMENTAL, behind a target's
// `egfx_h264` key (rdpH264.ts).
//
// A host that draws video with H.264 gives every surface it draws that way a stream
// of its own, and each stream is a chain: an access unit means "what changed since
// the one before it". So there is one `VideoDecoder` for each surface, made on the
// surface's first unit and closed when the surface is created again or deleted, and
// every unit of a stream goes through its decoder in the order it arrived, shown or
// not.
//
// The stream is the host's as it came: Annex B, its parameter sets inline at each
// keyframe, so a decoder is configured with a codec string and no description. The
// string is made from the parameter set's own profile and level, which the
// compositor's scan reads off the unit (egfxCompositor.ts), and a keyframe that
// names another configures the decoder again.
//
// **One picture for each unit, awaited.** The compositor composes a run's commands
// in order and takes a unit's picture where its command is, so a unit is decoded
// and its picture in hand before the run is composed. A decoder asked for low
// latency gives one picture out for one unit in on every browser this was tried
// with; one that gives none in time, or fails, ends the pipeline, since the host
// sends no keyframe to a client that asks and the units after it are a chain with a
// link missing.

import type { H264Unit } from "./egfxCompositor.ts";
import { rdpH264Config } from "./rdpH264.ts";

/**
 * How long a decoder may take over one access unit's picture. A decoder that is
 * starting takes the longest; one that has dropped the unit never answers.
 */
const PICTURE_TIMEOUT_MS = 5000;

export interface EgfxVideo {
  /**
   * Decode one access unit of its surface's stream. Resolves to the unit's picture,
   * which the caller closes; rejects where there is none to be had.
   */
  decode(unit: H264Unit, data: Uint8Array): Promise<VideoFrame>;
  /** The surface's stream is over: its decoder is done with. */
  drop(surface: number): void;
  /** Every decoder closed, and whatever is waiting on one rejected. */
  close(): void;
}

interface Waiting {
  resolve: (frame: VideoFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Stream {
  decoder: VideoDecoder;
  /** The codec string the decoder is configured with, null before a keyframe. */
  codec: string | null;
  /** The unit whose picture is awaited: one at a time, the caller's order. */
  waiting: Waiting | null;
  units: number;
}

export function createEgfxVideo(): EgfxVideo {
  const streams = new Map<number, Stream>();
  let closed = false;

  const settle = (stream: Stream): Waiting | null => {
    const waiting = stream.waiting;
    stream.waiting = null;
    if (waiting) {
      clearTimeout(waiting.timer);
    }
    return waiting;
  };

  const end = (stream: Stream, why: string) => {
    settle(stream)?.reject(new Error(why));
    if (stream.decoder.state !== "closed") {
      stream.decoder.close();
    }
  };

  const open = (surface: number): Stream => {
    const stream: Stream = {
      decoder: new VideoDecoder({
        output: (frame) => {
          const waiting = settle(stream);
          if (waiting) {
            waiting.resolve(frame);
          } else {
            // A picture nothing asked for: a second one for one unit.
            frame.close();
          }
        },
        error: (error) => {
          settle(stream)?.reject(
            new Error(`its H.264 decoder failed: ${error.message}`),
          );
        },
      }),
      codec: null,
      waiting: null,
      units: 0,
    };
    streams.set(surface, stream);
    return stream;
  };

  // The decoder configured for the stream a keyframe's parameter sets name, where
  // it is not already.
  const configure = async (stream: Stream, unit: H264Unit) => {
    if (unit.codec === null || unit.codec === stream.codec) {
      return;
    }
    const config = await rdpH264Config(unit.codec);
    if (closed || streams.get(unit.surface) !== stream) {
      throw new Error("its H.264 decoders are closed");
    }
    if (!config) {
      throw new Error(`this browser has no decoder for ${unit.codec}`);
    }
    stream.decoder.configure(config);
    stream.codec = unit.codec;
  };

  // One unit into its decoder, and the wait for its picture.
  const submit = (stream: Stream, unit: H264Unit, data: Uint8Array) =>
    new Promise<VideoFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (settle(stream)) {
          reject(new Error("its H.264 decoder gave no picture for a unit"));
        }
      }, PICTURE_TIMEOUT_MS);
      stream.waiting = { resolve, reject, timer };
      try {
        stream.decoder.decode(
          new EncodedVideoChunk({
            type: unit.key ? "key" : "delta",
            // Never shown by its time: a stream's units are numbered.
            timestamp: stream.units,
            data,
          }),
        );
        stream.units += 1;
      } catch (error) {
        settle(stream);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

  return {
    async decode(unit, data) {
      if (closed) {
        throw new Error("its H.264 decoders are closed");
      }
      const stream = streams.get(unit.surface) ?? open(unit.surface);
      await configure(stream, unit);
      if (stream.codec === null || stream.decoder.state !== "configured") {
        throw new Error("an H.264 stream did not start at a keyframe");
      }
      return submit(stream, unit, data);
    },
    drop(surface) {
      const stream = streams.get(surface);
      if (stream) {
        streams.delete(surface);
        end(stream, "its surface was deleted");
      }
    },
    close() {
      closed = true;
      for (const stream of streams.values()) {
        end(stream, "its H.264 decoders are closed");
      }
      streams.clear();
    },
  };
}
