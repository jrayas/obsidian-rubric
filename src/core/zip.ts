/** A minimal zip writer (and reader, for tests): files stored without compression, UTF-8 names. Pure; no Node or Obsidian APIs. */

export interface ZipEntry {
  /** Path inside the zip, with `/` separators. */
  path: string;
  data: Uint8Array;
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date, in local time; the zip format cannot hold years before 1980. */
function dosStamp(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const UTF8_FLAG = 0x0800;

export function makeZip(entries: ZipEntry[], when: Date): Uint8Array {
  if (entries.length > 0xffff) throw new Error('Too many files for a zip');
  const enc = new TextEncoder();
  const { time, date } = dosStamp(when);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: DataView, o: number, n: number) => v.setUint16(o, n, true);
  const u32 = (v: DataView, o: number, n: number) => v.setUint32(o, n >>> 0, true);

  for (const e of entries) {
    const name = enc.encode(e.path);
    const crc = crc32(e.data);
    if (e.data.length > 0xfffffffe || offset > 0xfffffffe) throw new Error('The zip would be too large');

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, UTF8_FLAG);
    u16(lv, 8, 0); // stored
    u16(lv, 10, time);
    u16(lv, 12, date);
    u32(lv, 14, crc);
    u32(lv, 18, e.data.length);
    u32(lv, 22, e.data.length);
    u16(lv, 26, name.length);
    u16(lv, 28, 0);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, (3 << 8) | 20); // made by: Unix, version 2.0
    u16(cv, 6, 20);
    u16(cv, 8, UTF8_FLAG);
    u16(cv, 10, 0);
    u16(cv, 12, time);
    u16(cv, 14, date);
    u32(cv, 16, crc);
    u32(cv, 20, e.data.length);
    u32(cv, 24, e.data.length);
    u16(cv, 28, name.length);
    u32(cv, 38, (0o100644 << 16) >>> 0); // a regular file, rw-r--r--
    u32(cv, 42, offset);
    cd.set(name, 46);

    chunks.push(local, e.data);
    central.push(cd);
    offset += local.length + e.data.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, cdSize);
  u32(ev, 16, offset);

  const out = new Uint8Array(offset + cdSize + 22);
  let at = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Read a zip made by `makeZip` (stored files only). Checks every CRC. Throws on anything else. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let endAt = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new Error('Not a zip file');
  const count = v.getUint16(endAt + 10, true);
  let p = v.getUint32(endAt + 16, true);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged zip directory');
    if (v.getUint16(p + 10, true) !== 0) throw new Error('Only stored files are supported');
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const path = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataAt = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.slice(dataAt, dataAt + size);
    if (crc32(data) !== crc) throw new Error(`Damaged file in zip: ${path}`);
    out.push({ path, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
