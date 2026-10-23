// 生成 assets/icon.ico：256x256 圆角深色底 + 白色便签线条
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 256;
const rgba = Buffer.alloc(S * S * 4);

const bg = [28, 27, 25];
const fg = [250, 249, 247];
const accent = [176, 141, 87];

const inRoundRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), S - r);
  const cy = Math.min(Math.max(y, r), S - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!inRoundRect(x + 0.5, y + 0.5, 56)) continue;
    let c = bg;
    // 三条“记录”线
    const lines = [[72, 112], [124, 164], [176, 200]];
    for (const [y0, x1] of lines) {
      if (y >= y0 - 7 && y <= y0 + 7 && x >= 64 && x <= x1) c = fg;
    }
    // 左侧项目圆点
    for (const [y0] of lines) {
      if ((x - 50) ** 2 + (y - y0) ** 2 <= 49) c = accent;
    }
    rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
  }
}

// BMP-in-ICO：底行优先，BGRA
const header = Buffer.alloc(40);
header.writeUInt32LE(40, 0);
header.writeInt32LE(S, 4);
header.writeInt32LE(S * 2, 8);
header.writeUInt16LE(1, 12);
header.writeUInt16LE(32, 14);
header.writeUInt32LE(0, 16);
header.writeUInt32LE(S * S * 4, 20);

const pixels = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const src = ((S - 1 - y) * S + x) * 4;
    const dst = (y * S + x) * 4;
    pixels[dst] = rgba[src + 2];
    pixels[dst + 1] = rgba[src + 1];
    pixels[dst + 2] = rgba[src];
    pixels[dst + 3] = rgba[src + 3];
  }
}
const andMask = Buffer.alloc((S / 8) * S); // 全不透明

const image = Buffer.concat([header, pixels, andMask]);
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // 0 表示 256
entry.writeUInt8(0, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(image.length, 8);
entry.writeUInt32LE(22, 12);

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([dir, entry, image]));

// 同时输出 PNG 供窗口/网页使用
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('icon written');
