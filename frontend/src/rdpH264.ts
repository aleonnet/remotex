// Whether this page decodes the H.264 an RDP host may draw with on a passed
// pipeline: the fourth question about itself the gateway is told, beside the chroma
// (videoChroma.ts), the Mac's stream (appleMedia.ts) and the pipeline itself
// (rdpGraphics.ts).
//
// EXPERIMENTAL, and behind a target's `egfx_h264` key. A host told its client takes
// H.264 hands the parts of the desktop that move like video to it. The gateway has
// no decoder for it and passes the access units on inside the pipeline's commands;
// this page decodes them with the browser's `VideoDecoder`, a stream for each
// surface (egfxVideo.ts), and has each picture's samples copied into the
// compositor's memory, where they are put into colour (egfxCompositor.ts).
//
// So the answer is two things, each asked of the browser itself: that it has a
// decoder for the stream a Windows host sends, and that a decoded picture can be
// copied into memory that is shared, which the compositor's is.
//
// It rides every session socket this page opens (`gateway.ts`). Unlike the others
// it turns no session away and greys no choice: a page that says no is passed a
// pipeline the host was told to keep H.264 out of.

/**
 * The stream asked about: what a Windows 11 host sent at 1280×800, as its sequence
 * parameter set names it — Main profile, level 3.2.
 */
const RDP_H264_PROBE = "avc1.4d4020";

let answer: boolean | null = null;

/**
 * How a decoder for the host's stream is configured: for one picture out for each
 * access unit in, which is what composing in command order needs. Which decoder
 * that is, the GPU's or one in software, is left to the browser, as it is for the
 * desktop's own stream (videoDecoder.ts). Null where the browser has none.
 */
export async function rdpH264Config(
  codec: string,
): Promise<VideoDecoderConfig | null> {
  const config: VideoDecoderConfig = { codec, optimizeForLatency: true };
  const support = await VideoDecoder.isConfigSupported(config);
  return support.supported === true ? config : null;
}

/** Whether a decoded picture's samples can be copied into shared memory. */
async function copiesIntoSharedMemory(): Promise<boolean> {
  // The smallest 4:2:0 picture: four luma samples and one of each chroma.
  const frame = new VideoFrame(new Uint8Array(6), {
    format: "I420",
    codedWidth: 2,
    codedHeight: 2,
    timestamp: 0,
  });
  try {
    await frame.copyTo(new Uint8Array(new SharedArrayBuffer(6)));
    return true;
  } finally {
    frame.close();
  }
}

/**
 * Ask the browser once, and remember the answer, which `decodesRdpH264()` then
 * says. Anything that throws reads as no.
 */
export async function chooseRdpH264(): Promise<boolean> {
  if (answer === null) {
    try {
      answer =
        (await rdpH264Config(RDP_H264_PROBE)) !== null &&
        (await copiesIntoSharedMemory());
    } catch {
      answer = false;
    }
  }
  return answer;
}

/**
 * Whether this page decodes a passed pipeline's H.264. Only valid after
 * `chooseRdpH264` has resolved, which `main.tsx` awaits before mounting.
 */
export function decodesRdpH264(): boolean {
  if (answer === null) {
    throw new Error("decodesRdpH264() read before chooseRdpH264() resolved");
  }
  return answer;
}

/** Test seam: forget the answer so the question can be asked again. */
export function resetRdpH264ForTests(): void {
  answer = null;
}
