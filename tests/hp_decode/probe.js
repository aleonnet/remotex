// Decode captured High Performance media with WebCodecs, by attempt rather than by
// asking: every configuration is configured and fed for real, and only what came out
// counts. `isConfigSupported` is asked afterwards and shown beside the result, so a
// probe that disagrees with the decoder is visible.

// ---- Annex B HEVC ---------------------------------------------------------------

/** NAL units of an Annex B stream, as views without start codes. */
export function splitAnnexB(bytes) {
  const nals = [];
  let start = -1;
  const n = bytes.length;
  let i = 0;
  while (i + 2 < n) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      if (start >= 0) {
        let end = i;
        while (end > start && bytes[end - 1] === 0) end--;
        nals.push(bytes.subarray(start, end));
      }
      i += 3;
      start = i;
    } else {
      i++;
    }
  }
  if (start >= 0 && start < n) nals.push(bytes.subarray(start, n));
  return nals;
}

const nalType = (nal) => (nal[0] >> 1) & 0x3f;
const isVcl = (t) => t < 32;
const isIrap = (t) => t >= 16 && t <= 23;
// Units that, after a picture's slices, open the next access unit.
const opensUnit = (t) => t === 35 || (t >= 32 && t <= 34) || t === 39 || (t >= 41 && t <= 44) || (t >= 48 && t <= 55);

/** Group NAL units into access units: one picture each, parameter sets with the picture after them. */
export function accessUnits(nals) {
  const units = [];
  let unit = { nals: [], vcl: false, key: false };
  for (const nal of nals) {
    const t = nalType(nal);
    const firstSlice = isVcl(t) && (nal[2] & 0x80) !== 0;
    if (unit.vcl && (opensUnit(t) || firstSlice)) {
      units.push(unit);
      unit = { nals: [], vcl: false, key: false };
    }
    unit.nals.push(nal);
    if (isVcl(t)) unit.vcl = true;
    if (isIrap(t)) unit.key = true;
  }
  if (unit.nals.length) units.push(unit);
  return units.filter((u) => u.vcl);
}

/** One access unit as Annex B bytes with 4-byte start codes. */
export function annexB(unit) {
  const size = unit.nals.reduce((sum, nal) => sum + 4 + nal.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const nal of unit.nals) {
    out.set([0, 0, 0, 1], at);
    out.set(nal, at + 4);
    at += 4 + nal.length;
  }
  return out;
}

function unescapeRbsp(nal) {
  const out = [];
  let zeros = 0;
  for (let i = 2; i < nal.length && out.length < 64; i++) {
    const b = nal[i];
    if (zeros >= 2 && b === 3) {
      zeros = 0;
      continue;
    }
    zeros = b === 0 ? zeros + 1 : 0;
    out.push(b);
  }
  return Uint8Array.from(out);
}

/** The RFC 6381 codec string an SPS names (ISO/IEC 14496-15 Annex E), sample entry `hev1`. */
export function codecFromSps(sps) {
  const r = unescapeRbsp(sps);
  // r[0]: vps id (4), max sub layers (3), temporal nesting (1); then profile_tier_level.
  const space = r[1] >> 6;
  const tier = (r[1] >> 5) & 1;
  const profile = r[1] & 0x1f;
  const compat = ((r[2] << 24) | (r[3] << 16) | (r[4] << 8) | r[5]) >>> 0;
  let reversed = 0;
  for (let b = 0; b < 32; b++) if (compat & (1 << b)) reversed |= 1 << (31 - b);
  const constraints = Array.from(r.subarray(6, 12));
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = r[12];
  const parts = [
    "hev1",
    `${["", "A", "B", "C"][space]}${profile}`,
    (reversed >>> 0).toString(16).toUpperCase(),
    `${tier ? "H" : "L"}${level}`,
    ...constraints.map((c) => c.toString(16).toUpperCase()),
  ];
  return parts.join(".");
}

// ---- Length-prefixed AAC-ELD ----------------------------------------------------

/** Access units of the gateway's `audio.eld`: each behind its length as a big-endian u32. */
export function splitLengthPrefixed(bytes) {
  const units = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 4 <= bytes.length) {
    const len = view.getUint32(at);
    at += 4;
    if (at + len > bytes.length) break;
    units.push(bytes.subarray(at, at + len));
    at += len;
  }
  return units;
}

export const hex = (s) => (s === "none" || s === "-" ? undefined : Uint8Array.from(s.match(/../g).map((b) => Number.parseInt(b, 16))));

// ---- Attempts --------------------------------------------------------------------

const timeout = (ms, what) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer in ${ms} ms`)), ms));

async function probed(ask) {
  try {
    const support = await ask();
    return support.supported ? "yes" : "no";
  } catch (e) {
    return `threw ${e.name}`;
  }
}

/** Configure one VideoDecoder and feed it `units`; report what came out. */
export async function tryVideo({ codec, hardwareAcceleration }, units, canvas) {
  const config = { codec, optimizeForLatency: true };
  if (hardwareAcceleration) config.hardwareAcceleration = hardwareAcceleration;
  const result = { codec, hardwareAcceleration: hardwareAcceleration ?? "(unset)", fed: 0, decoded: 0, error: null, first: null, ms: 0 };
  const started = performance.now();
  let error = null;
  const decoder = new VideoDecoder({
    output(frame) {
      if (result.decoded === 0) {
        result.first = {
          format: frame.format,
          coded: `${frame.codedWidth}x${frame.codedHeight}`,
          display: `${frame.displayWidth}x${frame.displayHeight}`,
          colorSpace: frame.colorSpace?.toJSON?.() ?? null,
        };
      }
      result.decoded++;
      if (canvas && (result.decoded === 1 || result.decoded % 30 === 0)) {
        canvas.getContext("2d").drawImage(frame, 0, 0, canvas.width, canvas.height);
      }
      frame.close();
    },
    error(e) {
      error = e;
    },
  });
  try {
    decoder.configure(config);
    const firstKey = units.findIndex((u) => u.key);
    if (firstKey < 0) throw new Error("no IRAP picture in the stream");
    for (let i = firstKey; i < units.length && !error && decoder.state === "configured"; i++) {
      while (decoder.decodeQueueSize > 8 && !error) {
        await new Promise((resolve) => decoder.addEventListener("dequeue", resolve, { once: true }));
      }
      decoder.decode(new EncodedVideoChunk({ type: units[i].key ? "key" : "delta", timestamp: (i - firstKey) * 33_333, data: annexB(units[i]) }));
      result.fed++;
    }
    if (!error && decoder.state === "configured") await Promise.race([decoder.flush(), timeout(20_000, "flush")]);
  } catch (e) {
    error ??= e;
  }
  result.ms = Math.round(performance.now() - started);
  result.error = error ? `${error.name}: ${error.message}` : null;
  if (decoder.state !== "closed") decoder.close();
  result.probe = await probed(() => VideoDecoder.isConfigSupported(config));
  return result;
}

/** Configure one AudioDecoder and feed it `units`; report what came out, and keep the PCM. */
export async function tryAudio({ codec, description, sampleRate, numberOfChannels }, units) {
  const config = { codec, sampleRate, numberOfChannels };
  if (description) config.description = description;
  const result = { codec, description: description ? [...description].map((b) => b.toString(16).padStart(2, "0")).join("") : "none", sampleRate, numberOfChannels, fed: 0, decoded: 0, frames: 0, error: null, first: null, peak: 0, rms: 0, ms: 0 };
  const started = performance.now();
  const channels = [];
  let error = null;
  let squares = 0;
  let samples = 0;
  const decoder = new AudioDecoder({
    output(data) {
      if (result.decoded === 0) {
        result.first = { format: data.format, sampleRate: data.sampleRate, numberOfChannels: data.numberOfChannels, numberOfFrames: data.numberOfFrames };
      }
      result.decoded++;
      result.frames += data.numberOfFrames;
      for (let c = 0; c < data.numberOfChannels; c++) {
        const plane = new Float32Array(data.numberOfFrames);
        data.copyTo(plane, { planeIndex: c, format: "f32-planar" });
        (channels[c] ??= []).push(plane);
        for (const s of plane) {
          const a = Math.abs(s);
          if (a > result.peak) result.peak = a;
          squares += s * s;
        }
        samples += plane.length;
      }
      data.close();
    },
    error(e) {
      error = e;
    },
  });
  try {
    decoder.configure(config);
    for (let i = 0; i < units.length && !error && decoder.state === "configured"; i++) {
      while (decoder.decodeQueueSize > 32 && !error) {
        await new Promise((resolve) => decoder.addEventListener("dequeue", resolve, { once: true }));
      }
      decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: i * 10_000, data: units[i] }));
      result.fed++;
    }
    if (!error && decoder.state === "configured") await Promise.race([decoder.flush(), timeout(20_000, "flush")]);
  } catch (e) {
    error ??= e;
  }
  result.ms = Math.round(performance.now() - started);
  result.error = error ? `${error.name}: ${error.message}` : null;
  const dbfs = (v) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dBFS` : "silence");
  result.peak = dbfs(result.peak);
  result.rms = dbfs(samples ? Math.sqrt(squares / samples) : 0);
  if (decoder.state !== "closed") decoder.close();
  result.probe = await probed(() => AudioDecoder.isConfigSupported(config));
  const rate = result.first?.sampleRate ?? sampleRate;
  return { result, pcm: channels.length ? { rate, channels } : null };
}
