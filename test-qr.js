const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const QR = require('./js/qrcode.js');
const jsQR = require('jsqr');

function matrixToRGBA(matrix, size, scale) {
  scale = scale || 8;
  const qz = 4 * scale;
  const px = size * scale + qz * 2;
  const data = new Uint8ClampedArray(px * px * 4);
  function set(x, y, dark) {
    const i = (y * px + x) * 4;
    data[i] = dark ? 0 : 255;
    data[i + 1] = dark ? 0 : 255;
    data[i + 2] = dark ? 0 : 255;
    data[i + 3] = 255;
  }
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const qx = x - qz;
      const qy = y - qz;
      let dark = false;
      if (qx >= 0 && qy >= 0 && qx < size * scale && qy < size * scale) {
        const mr = Math.floor(qy / scale);
        const mc = Math.floor(qx / scale);
        dark = matrix[mr * size + mc] === 1;
      }
      set(x, y, dark);
    }
  }
  return { data, width: px, height: px };
}

function writePNG(file, matrix, size, scale) {
  scale = scale || 6;
  const qz = 4 * scale;
  const px = size * scale + qz * 2;
  const raw = Buffer.alloc(px * (px * 4 + 1));
  let i = 0;
  for (let y = 0; y < px; y++) {
    raw[i++] = 0;
    for (let x = 0; x < px; x++) {
      const qx = x - qz;
      const qy = y - qz;
      let dark = false;
      if (qx >= 0 && qy >= 0 && qx < size * scale && qy < size * scale) {
        const mr = Math.floor(qy / scale);
        const mc = Math.floor(qx / scale);
        dark = matrix[mr * size + mc] === 1;
      }
      raw[i++] = dark ? 0 : 255;
      raw[i++] = dark ? 0 : 255;
      raw[i++] = dark ? 0 : 255;
      raw[i++] = 255;
    }
  }
  function chunk(type, data2) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data2.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data2])) >>> 0);
    return Buffer.concat([len, typeBuf, data2, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path.join(__dirname, file), png);
}
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const cases = [
  ['0812345678', 300, 'M'],
  ['0812345678', 300, 'L'],
  ['08123456780', 1399.99, 'M'],
  ['1234567890121', 2500, 'M'],
  ['0891234567', 50, 'M'],
  ['0891234567', 0, 'M'],
];

let allPass = true;
for (const [target, amount, ec] of cases) {
  const payload = QR.promptpayPayload(target, amount);
  const qr = QR.createMatrix(payload, ec);
  const img = matrixToRGBA(qr.matrix, qr.size, 8);
  const result = jsQR(img.data, img.width, img.height);
  const ok = result && result.data === payload;
  console.log((ok ? 'DECODE-PASS' : 'DECODE-FAIL') + ' target=' + target + ' amount=' + amount + ' ec=' + ec +
    ' (version ' + qr.version + ')');
  if (!ok) {
    console.log('  expected: ' + payload);
    console.log('  decoded : ' + (result && result.data));
    allPass = false;
  }
}

// render one sample PNG for the user
const sample = QR.createMatrix(QR.promptpayPayload('0812345678', 300), 'M');
writePNG('assets/test-qr.png', sample.matrix, sample.size, 6);
console.log('wrote assets/test-qr.png');

if (!allPass) process.exit(1);