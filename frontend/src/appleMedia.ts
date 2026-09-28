// Whether this browser decodes a High Performance Mac's own media stream, picture and
// sound: the second question about its decoders the gateway is told, asked once,
// before the client mounts, beside the chroma (videoChroma.ts).
//
// A target with `media_passthrough` passes the Mac's stream to a browser that says yes
// — its HEVC instead of VP9 encoded from decoded pictures, its AAC-ELD instead of Opus
// encoded from decoded sound — and a browser that says no is sent VP9 and Opus as from
// any other target. One answer covers both halves. Every browser measured that decodes
// the picture decodes the sound too (Chrome and Safari, on macOS and iOS), and one that
// decodes only the sound (Chrome on a GPU without HEVC Range Extensions) loses nothing
// by being sent both re-encoded. Firefox decodes neither. The answer rides every session
// socket this page opens (`gateway.ts`), for the same reason the chroma does.
//
// The two halves are asked differently:
// - The picture, HEVC Range Extensions 4:4:4: `VideoDecoder.isConfigSupported`, which
//   answered as the decoder then behaved on every browser measured.
// - The sound: `AudioDecoder.isConfigSupported`, then a real decode of one of the
//   Mac's own units in each form it says yes to. No codec string names AAC-ELD to both
//   Chrome and Safari — both refuse `mp4a.40.39` — so both are asked for AAC's
//   `mp4a.40.2`, and they need the AudioSpecificConfig differently: Chrome as it is,
//   Safari inside an MPEG-4 ES_Descriptor, since the CoreAudio call WebKit reads it
//   with refuses a bare one and WebKit then decodes as AAC-LC without it. Both say
//   yes to both forms, so a yes only narrows the forms worth decoding and decoding
//   picks one. The configuration that decoded is the one the player then uses
//   (`appleEldConfig`).
//
// Selection, as with the chroma — but the other way round on a doubt. VP9 and Opus are
// what every browser here decodes, so only a definite "yes" asks for the Mac's stream,
// and anything that throws reads as "no". The one refusal it can lead to is the
// gateway's: a build without the `apple-hp-media` decoders has nothing else to send.

/**
 * The picture asked about: macwork's stream, 1600×1000, as its sequence parameter
 * set names it (`parse_sps` in src/vnc_apple_media.rs) — Range Extensions, level 5.0,
 * the 4:4:4 constraint flags.
 */
const APPLE_HEVC_PROBE = "hev1.4.10.L150.BE.8";

/** The codec string the gateway names the Mac's passed sound with (`PASSED_SOUND`). */
export const APPLE_ELD_CODEC = "mp4a.40.39";

/** What both browsers accept AAC-ELD under: AAC's own string, not ELD's. */
const ELD_DECODE_CODEC = "mp4a.40.2";

/** The Mac's AudioSpecificConfig (src/aac_eld.rs): ELD, 48 kHz, stereo, 480 frames. */
const ELD_CONFIG = Uint8Array.of(0xf8, 0xe6, 0x50, 0x00);

/** One of the Mac's 10 ms units, captured with `tests/hp_capture.sh`, to decode. */
const ELD_UNIT =
  "if////wdb7QoEQX5+fPnj64ZercOrmZxlTXLPDnPQjO35Hiu7IH2xLp/sEn0L1kRq36BpEhJqdBEZM6DJHKTXVI365CnaJYPFk4l8jSwxA6CS5OQ1EZkuzIRKTMJvjkbMshPhkiyicnFkaWdoRpJ9cmq2RhYuxDEgUSYbxHJ5m7K1pYbBcQR0eWrDBEhVMh4cjpcSRrkJDiSbbI3rBFo/21Q1yNuZYoO0smxyMtsuhr4ie+RwsuzT7UIpvEb0miQPBEc0jOZ8y4SIoxGMfkmGkRQyMYnYMgkSRyMg/dOIkRxiMY36XukiuuRqv/O/MkV1SNRujcukQOItBiuac6tItBpHNOdW49ZiOK51Zj1eI4rnVePV4jiuTVYCrEcJuklikp2K3SOxR07FbpHYo6dhtuisUdOw3feFak77wrUnfeFak77wrUnMeFak5jwrUnMeFak5jtrUm5xWTXOKyaxxWTWOKyaTNZNJmsmkzWTSZrJs8OeHPDnhkQ95AA=";

/** How long one decode attempt may take to answer before it counts as a no. */
let attemptTimeoutMs = 2000;

/**
 * An AudioSpecificConfig inside an MPEG-4 ES_Descriptor (ISO/IEC 14496-1): ES_ID 1,
 * and a DecoderConfigDescriptor for MPEG-4 audio (0x40, an audio stream) whose
 * DecoderSpecificInfo is `config`. What CoreAudio's `kAudioFormatProperty_FormatInfo`
 * reads an AAC configuration from.
 */
export function esDescriptor(config: Uint8Array): Uint8Array {
  const specific = [0x05, config.length, ...config];
  const decoderConfig = [
    0x04,
    13 + specific.length,
    0x40,
    0x15,
    ...[0x00, 0x18, 0x00],
    ...[0, 0, 0, 0],
    ...[0, 0, 0, 0],
    ...specific,
  ];
  return Uint8Array.from([
    0x03,
    3 + decoderConfig.length,
    0x00,
    0x01,
    0x00,
    ...decoderConfig,
  ]);
}

/** How a browser's `AudioDecoder` takes the Mac's configuration as `description`. */
type Description = (config: Uint8Array) => Uint8Array;

const FORMS: Description[] = [(config) => config, esDescriptor];

let answer: { decodes: boolean; sound: Description | null } | null = null;

async function decodesPicture(): Promise<boolean> {
  try {
    const support = await VideoDecoder.isConfigSupported({
      codec: APPLE_HEVC_PROBE,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

/**
 * Whether the browser says it takes `description`, and a decoder configured with it
 * then turns the unit into sound.
 */
async function decodesSound(description: Uint8Array): Promise<boolean> {
  const config: AudioDecoderConfig = {
    codec: ELD_DECODE_CODEC,
    sampleRate: 48_000,
    numberOfChannels: 2,
    description,
  };
  try {
    const support = await AudioDecoder.isConfigSupported(config);
    if (support.supported !== true) {
      return false;
    }
  } catch {
    return false;
  }
  let output = false;
  let failed = false;
  let decoder: AudioDecoder | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    decoder = new AudioDecoder({
      output: (data) => {
        output = true;
        data.close();
      },
      error: () => {
        failed = true;
      },
    });
    decoder.configure(config);
    const data = Uint8Array.from(atob(ELD_UNIT), (c) => c.charCodeAt(0));
    decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: 0, data }));
    const unanswered = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("no answer")),
        attemptTimeoutMs,
      );
    });
    await Promise.race([decoder.flush(), unanswered]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    if (decoder && decoder.state !== "closed") {
      decoder.close();
    }
  }
  return output && !failed;
}

/** Ask the browser once, and remember the answer for `decodesAppleMedia()`. */
export async function chooseAppleMedia(): Promise<boolean> {
  if (answer !== null) {
    return answer.decodes;
  }
  let sound: Description | null = null;
  if (await decodesPicture()) {
    for (const form of FORMS) {
      if (await decodesSound(form(ELD_CONFIG))) {
        sound = form;
        break;
      }
    }
  }
  answer = { decodes: sound !== null, sound };
  return answer.decodes;
}

/**
 * The answer. Only valid after `chooseAppleMedia` has resolved, which `main.tsx`
 * awaits before mounting.
 */
export function decodesAppleMedia(): boolean {
  if (answer === null) {
    throw new Error("decodesAppleMedia() before chooseAppleMedia() resolved");
  }
  return answer.decodes;
}

/**
 * The decoder configuration for the Mac's passed sound, as announced (`sampleRate`,
 * `channels`, and its AudioSpecificConfig as `head`), in the form this browser
 * decoded at load.
 */
export function appleEldConfig(format: {
  sampleRate: number;
  channels: number;
  head: Uint8Array;
}): AudioDecoderConfig {
  const form = answer?.sound;
  if (!form) {
    throw new Error(
      "the gateway passed the Mac's sound to a page that said it does not decode it",
    );
  }
  return {
    codec: ELD_DECODE_CODEC,
    sampleRate: format.sampleRate,
    numberOfChannels: format.channels,
    description: form(format.head),
  };
}

/** Test seam: forget the answer so the question can be asked again. */
export function resetAppleMediaForTests(timeoutMs = 2000): void {
  answer = null;
  attemptTimeoutMs = timeoutMs;
}
