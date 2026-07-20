export const WAVEFORM_BINARY_ENCODING = "f32le-4-u32le-1-v1" as const;
export const WAVEFORM_BINARY_RECORD_BYTES = 20;
export const WAVEFORM_BINARY_MAX_POINTS = 21_600;

export type PackedWaveformPoint = {
  t: number;
  min: number;
  max: number;
  rms: number;
  sample_count: number;
};

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const waveformEncodingCache = new WeakMap<object, string>();

export function encodeWaveformPoints(points: readonly PackedWaveformPoint[]): string {
  const cached = waveformEncodingCache.get(points);
  if (cached !== undefined) return cached;
  if (points.length > WAVEFORM_BINARY_MAX_POINTS) {
    throw new Error(`Waveform exceeds the ${WAVEFORM_BINARY_MAX_POINTS}-point limit.`);
  }

  const bytes = new Uint8Array(points.length * WAVEFORM_BINARY_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  points.forEach((point, index) => {
    validatePoint(point, index);
    const offset = index * WAVEFORM_BINARY_RECORD_BYTES;
    view.setFloat32(offset, point.t, true);
    view.setFloat32(offset + 4, point.min, true);
    view.setFloat32(offset + 8, point.max, true);
    view.setFloat32(offset + 12, point.rms, true);
    view.setUint32(offset + 16, point.sample_count, true);
  });
  const encoded = bytesToBase64(bytes);
  waveformEncodingCache.set(points, encoded);
  return encoded;
}

export function decodeWaveformPoints(dataBase64: string, pointCount: number): PackedWaveformPoint[] {
  if (!Number.isInteger(pointCount) || pointCount < 0 || pointCount > WAVEFORM_BINARY_MAX_POINTS) {
    throw new Error("Invalid waveform point count.");
  }
  const bytes = base64ToBytes(dataBase64);
  const expectedBytes = pointCount * WAVEFORM_BINARY_RECORD_BYTES;
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`Waveform binary length is ${bytes.byteLength}; expected ${expectedBytes}.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const points: PackedWaveformPoint[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    const offset = index * WAVEFORM_BINARY_RECORD_BYTES;
    const point: PackedWaveformPoint = {
      t: view.getFloat32(offset, true),
      min: view.getFloat32(offset + 4, true),
      max: view.getFloat32(offset + 8, true),
      rms: view.getFloat32(offset + 12, true),
      sample_count: view.getUint32(offset + 16, true),
    };
    validatePoint(point, index);
    points.push(point);
  }
  return points;
}

function validatePoint(point: PackedWaveformPoint, index: number) {
  if (!Number.isFinite(point.t) || point.t < 0) throw new Error(`Invalid waveform time at point ${index}.`);
  if (!Number.isFinite(point.min)) throw new Error(`Invalid waveform minimum at point ${index}.`);
  if (!Number.isFinite(point.max)) throw new Error(`Invalid waveform maximum at point ${index}.`);
  if (!Number.isFinite(point.rms)) throw new Error(`Invalid waveform RMS at point ${index}.`);
  if (!Number.isInteger(point.sample_count) || point.sample_count < 0 || point.sample_count > 0xffff_ffff) {
    throw new Error(`Invalid waveform sample count at point ${index}.`);
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let output = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output +=
      BASE64_ALPHABET[(value >>> 18) & 63] +
      BASE64_ALPHABET[(value >>> 12) & 63] +
      BASE64_ALPHABET[(value >>> 6) & 63] +
      BASE64_ALPHABET[value & 63];
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const value = bytes[index] << 16;
    output += BASE64_ALPHABET[(value >>> 18) & 63] + BASE64_ALPHABET[(value >>> 12) & 63] + "==";
  } else if (remaining === 2) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8);
    output +=
      BASE64_ALPHABET[(value >>> 18) & 63] +
      BASE64_ALPHABET[(value >>> 12) & 63] +
      BASE64_ALPHABET[(value >>> 6) & 63] +
      "=";
  }
  return output;
}

function base64ToBytes(value: string) {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid waveform Base64 data.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index]);
    const second = BASE64_ALPHABET.indexOf(value[index + 1]);
    const third = value[index + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]);
    const fourth = value[index + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]);
    const packed = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (packed >>> 16) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = (packed >>> 8) & 0xff;
    if (outputIndex < bytes.length) bytes[outputIndex++] = packed & 0xff;
  }
  return bytes;
}
