/*
 * ESS Fitness - QRCodeLib
 * Self-contained PromptPay QR payload + pure-JS QR code encoder (byte mode).
 * No external dependencies. Works in browser (script tag) and Node.js (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QRCodeLib = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ==================================================================
  // GF(256) helpers for Reed-Solomon (poly 0x11D)
  // ==================================================================
  var gfExp = new Array(512);
  var gfLog = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      gfExp[i] = x;
      gfLog[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) gfExp[j] = gfExp[j - 255];
    gfLog[0] = 0;
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return gfExp[(gfLog[a] + gfLog[b]) % 255];
  }

  function rsGeneratorPoly(nsym) {
    var gen = [1];
    for (var i = 0; i < nsym; i++) {
      var next = new Array(gen.length + 1).fill(0);
      for (var j = 0; j < gen.length; j++) {
        next[j] ^= gen[j];
        next[j + 1] ^= gfMul(gen[j], gfExp[i]);
      }
      gen = next;
    }
    return gen;
  }

  function rsEncode(data, nsym) {
    var gen = rsGeneratorPoly(nsym);
    var result = data.slice();
    for (var i = 0; i < result.length; i++) result[i] = result[i] | 0;
    for (var i2 = 0; i2 < data.length; i2++) {
      var coef = result[i2];
      if (coef !== 0) {
        for (var j = 1; j <= nsym; j++) {
          result[i2 + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return result.slice(data.length);
  }

  // ==================================================================
  // CRC16-CCITT (poly 0x1021, init 0xFFFF, MSB-first) as used by EMVCo QR
  // ==================================================================
  function crc16(data) {
    var crc = 0xffff;
    for (var i = 0; i < data.length; i++) {
      crc ^= (data.charCodeAt(i) & 0xff) << 8;
      for (var b = 0; b < 8; b++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xffff;
      }
    }
    var hex = crc.toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    return hex;
  }

  function emvField(id, value) {
    var len = String(value.length);
    while (len.length < 2) len = '0' + len;
    return id + len + value;
  }

  function formatPromptpayTarget(digits) {
    if (digits.length >= 13) return digits;
    return ('0000000000000' + digits.replace(/^0/, '66')).slice(-13);
  }

  // ==================================================================
  // PromptPay QR payload (EMVCo style, mirrors mature implementations)
  // target: 10-digit mobile, 13-digit tax/national ID, 15+ e-Wallet ID
  // ==================================================================
  function promptpayPayload(target, amount) {
    var digits = (target || '').replace(/\D/g, '');
    var targetType;
    var fmtTarget;
    if (digits.length >= 15) {
      targetType = '03';            // e-Wallet ID
      fmtTarget = digits;
    } else if (digits.length >= 13) {
      targetType = '02';            // tax / national ID
      fmtTarget = digits;
    } else {
      targetType = '01';            // mobile number
      fmtTarget = formatPromptpayTarget(digits);
    }
    var data = '';
    data += emvField('00', '01');                                                   // payload format
    data += emvField('01', (typeof amount === 'number' && amount > 0) ? '12' : '11'); // POI method (dynamic/static)
    data += emvField('29', emvField('00', 'A000000677010111') + emvField(targetType, fmtTarget));
    data += emvField('58', 'TH');
    data += emvField('53', '764');
    if (typeof amount === 'number' && amount > 0) {
      data += emvField('54', amount.toFixed(2));
    }
    data += '6304' + crc16(data + '6304');
    return data;
  }

  // ==================================================================
  // QR code constants
  // ==================================================================
  // [version] = total codewords
  var TOTAL_CODEWORDS = [null,
    26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
  ];
  // EC level M: [version] = ecc codewords per block  (level M = 0)
  var ECC_PER_BLOCK_M = [null,
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 28,
  ];
  // EC level L ecc per block
  var ECC_PER_BLOCK_L = [null,
    7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
  ];
  // [version] = number of RS blocks
  var RS_BLOCKS_M = [null, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];
  var RS_BLOCKS_L = [null, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8];

  // [version] = data codewords per block (group1), then group2 length
  // group2 blocks have DATA_PER_BLOCK[version][1] codewords each when extra
  var ALIGN_POS = [null,
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  ];
  var VERSION_INFO = [null, null, null, null, null, null, null,
    0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d, 0x0f928, 0x10b78, 0x1145d,
    0x12a17, 0x13532, 0x149a6,
  ];

  // ==================================================================
  // QR encoder
  // ==================================================================
  function chooseVersion(text, ecLevelBits) {
    // available data bits for byte mode
    for (var v = 1; v <= 20; v++) {
      var dataCodewords = TOTAL_CODEWORDS[v] -
        (ecLevelBits === 1
          ? ECC_PER_BLOCK_L[v] * RS_BLOCKS_L[v]
          : ECC_PER_BLOCK_M[v] * RS_BLOCKS_M[v]);
      var totalBits = dataCodewords * 8;
      var countBits = v <= 9 ? 8 : 16;
      var capacity = Math.floor((totalBits - 4 - countBits) / 8);
      if (text.length <= capacity) return v;
    }
    throw new Error('Data too long for QR code');
  }

  function buildBitStream(text, version, dataCodewords) {
    var bits = [];
    function push(value, count) {
      for (var i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }
    push(4, 4); // byte mode
    push(text.length, version <= 9 ? 8 : 16); // char count
    for (var i = 0; i < text.length; i++) push(text.charCodeAt(i) & 0xff, 8);
    // terminator
    var capacity = dataCodewords * 8;
    for (var t = 0; t < Math.min(4, capacity - bits.length); t++) bits.push(0);
    // pad to byte
    while (bits.length % 8) bits.push(0);
    // pad codewords
    var padBit = [0xec, 0x11];
    var idx = 0;
    while (bits.length < capacity) {
      var byte = padBit[idx % 2];
      idx++;
      for (var b = 7; b >= 0; b--) bits.push((byte >> b) & 1);
    }
    return bits;
  }

  function placeFinder(m, size, r, c) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr;
        var cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        var border = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        var center = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        m[rr * size + cc] = (inOuter && (border || center)) ? 1 : 0;
      }
    }
  }

  function overlapsFinder(size, r, c) {
    var areas = [
      { x0: 0, y0: 0, x1: 8, y1: 8 },
      { x0: size - 9, y0: 0, x1: size - 1, y1: 8 },
      { x0: 0, y0: size - 9, x1: 8, y1: size - 1 },
    ];
    for (var i = 0; i < areas.length; i++) {
      var a = areas[i];
      // alignment pattern spans [r-2, r+2] x [c-2, c+2]
      if (r + 2 >= a.x0 && r - 2 <= a.x1 && c + 2 >= a.y0 && c - 2 <= a.y1) return true;
    }
    return false;
  }

  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
    return false;
  }

  function penaltyScore(m, size) {
    var score = 0;
    // N1 rows + N3 rows
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) row.push(m[r * size + c]);
      addRunN1(row);
      addN3(row);
    }
    // N1 cols + N3 cols
    for (var c2 = 0; c2 < size; c2++) {
      var col = [];
      for (var r2 = 0; r2 < size; r2++) col.push(m[r2 * size + c2]);
      addRunN1(col);
      addN3(col);
    }
    // N2 2x2 blocks
    for (var r3 = 0; r3 < size - 1; r3++) {
      for (var c3 = 0; c3 < size - 1; c3++) {
        var v = m[r3 * size + c3];
        if (m[r3 * size + c3 + 1] === v && m[(r3 + 1) * size + c3] === v && m[(r3 + 1) * size + c3 + 1] === v) {
          score += 3;
        }
      }
    }
    // N4 dark proportion
    var dark = 0;
    for (var i = 0; i < size * size; i++) if (m[i]) dark++;
    var percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;
    return score;

    function addRunN1(arr) {
      var val = -1;
      var run = 0;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] === val) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          val = arr[i];
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    function addN3(arr) {
      for (var i = 0; i < arr.length - 6; i++) {
        if (arr[i] === 1 && arr[i + 1] === 0 && arr[i + 2] === 1 && arr[i + 3] === 1 &&
            arr[i + 4] === 1 && arr[i + 5] === 0 && arr[i + 6] === 1) {
          var left = (i - 4 >= 0 && arr[i - 1] === 0 && arr[i - 2] === 0 && arr[i - 3] === 0 && arr[i - 4] === 0);
          var right = (i + 11 < arr.length && arr[i + 7] === 0 && arr[i + 8] === 0 && arr[i + 9] === 0 && arr[i + 10] === 0);
          if (left || right) score += 40;
        }
      }
    }
  }

  function bch15_5(data) {
    var d = data << 10;
    for (var i = 14; i >= 10; i--) {
      if (d & (1 << i)) d ^= 0x537 << (i - 10);
    }
    return ((data << 10) | d) ^ 0x5412;
  }

  function createMatrix(text, ecLevel) {
    ecLevel = ecLevel || 'M'; // 'L' or 'M'
    var ecBits = ecLevel === 'L' ? 1 : 0;
    var version = chooseVersion(text, ecBits);
    var size = version * 4 + 17;
    var total = TOTAL_CODEWORDS[version];
    var eccLen = ecLevel === 'L' ? ECC_PER_BLOCK_L[version] : ECC_PER_BLOCK_M[version];
    var blockCount = ecLevel === 'L' ? RS_BLOCKS_L[version] : RS_BLOCKS_M[version];
    var dataTotal = total - eccLen * blockCount;
    var bits = buildBitStream(text, version, dataTotal);

    // assemble codewords
    var dataArr = [];
    for (var i = 0; i < dataTotal; i++) {
      var byte = 0;
      for (var b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
      dataArr.push(byte);
    }

    // split into blocks
    var base = Math.floor(dataTotal / blockCount);
    var extra = dataTotal % blockCount;
    var blocks = [];
    var ptr = 0;
    for (var blk = 0; blk < blockCount; blk++) {
      var len = blk < extra ? base + 1 : base;
      var bd = dataArr.slice(ptr, ptr + len);
      ptr += len;
      blocks.push({ data: bd, ecc: rsEncode(bd, eccLen) });
    }

    // interleave
    var codewords = [];
    var maxData = blocks[0].data.length;
    for (var di = 0; di < maxData; di++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (di < blocks[bi].data.length) codewords.push(blocks[bi].data[di]);
      }
    }
    for (var ei = 0; ei < eccLen; ei++) {
      for (var bi2 = 0; bi2 < blocks.length; bi2++) {
        codewords.push(blocks[bi2].ecc[ei]);
      }
    }

    // matrix init (-1 = unset)
    var m = new Int8Array(size * size).fill(-1);

    // function patterns
    placeFinder(m, size, 0, 0);
    placeFinder(m, size, 0, size - 7);
    placeFinder(m, size, size - 7, 0);

    // timing patterns
    for (var t1 = 8; t1 <= size - 9; t1++) {
      if (m[t1 * size + 6] === -1) m[t1 * size + 6] = (t1 % 2 === 0) ? 1 : 0;
      if (m[6 * size + t1] === -1) m[6 * size + t1] = (t1 % 2 === 0) ? 1 : 0;
    }

    // alignment patterns
    var positions = ALIGN_POS[version];
    for (var pi = 0; pi < positions.length; pi++) {
      for (var pj = 0; pj < positions.length; pj++) {
        var ar = positions[pi];
        var ac = positions[pj];
        if (overlapsFinder(size, ar, ac)) continue;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var rr = ar + dr;
            var cc = ac + dc;
            var edge = Math.abs(dr) === 2 || Math.abs(dc) === 2;
            var core = dr === 0 && dc === 0;
            m[rr * size + cc] = (edge || core) ? 1 : 0;
          }
        }
      }
    }

    // dark module
    m[(size - 8) * size + 8] = 1;

    // reserve format info cells (top-left + split corners)
    var fmtCells = [];
    function reserve(fr, fc) { m[fr * size + fc] = 0; fmtCells.push([fr, fc]); }
    for (var i5 = 0; i5 <= 8; i5++) {
      if (i5 === 6) continue;
      reserve(8, i5); // top-left (8,0..5),(8,7),(8,8)
      if (i5 !== 8) reserve(i5, 8);
    }
    for (var i2 = 0; i2 <= 6; i2++) reserve(size - 1 - i2, 8);      // bottom-left col 8 (7 cells)
    for (var i3 = 7; i3 <= 14; i3++) reserve(8, size - 15 + i3);     // top-right row 8 (8 cells, incl (8,size-8))
    // note (8,8) reserved above sets the split point

    // reserve version info cells for v>=7
    if (version >= 7) {
      for (var vri = 0; vri < 18; vri++) {
        var vr = Math.floor(vri / 3);
        var vc = (vri % 3) + size - 11;
        m[vr * size + vc] = 0;
        m[vc * size + vr] = 0;
      }
    }

    // build bit array indexer
    var idx = 0;

    // evaluate all 8 masks
    var bestMask = 0;
    var bestScore = Infinity;
    var bestMatrix = null;
    for (var mask = 0; mask < 8; mask++) {
      var mm = new Int8Array(m);
      idx = 0;
      var upward = true;
      for (var col = size - 1; col >= 1; col -= 2) {
        if (col === 6) col--;
        if (col < 0) break;
        for (var rr2 = 0; rr2 < size; rr2++) {
          var crow = upward ? size - 1 - rr2 : rr2;
          for (var ccIdx = 0; ccIdx < 2; ccIdx++) {
            var ccol = col - ccIdx;
            if (mm[crow * size + ccol] !== -1) continue;
            var bit = codewords[Math.floor(idx / 8)] >> (7 - (idx % 8)) & 1;
            idx++;
            var masked = bit ^ (maskBit(mask, crow, ccol) ? 1 : 0);
            mm[crow * size + ccol] = masked;
          }
        }
        upward = !upward;
      }
      var score = penaltyScore(mm, size);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
        bestMatrix = mm;
      }
      if (idx < codewords.length * 8) {
        // should not happen; capacity chosen correctly
      }
    }

    // place format info on best matrix
    var format = bch15_5((ecBits << 3) | bestMask);
    var fbits = [];
    for (var fbi = 0; fbi < 15; fbi++) fbits.push((format >> fbi) & 1);
    // top-left
    bestMatrix[8 * size + 0] = fbits[14];
    bestMatrix[8 * size + 1] = fbits[13];
    bestMatrix[8 * size + 2] = fbits[12];
    bestMatrix[8 * size + 3] = fbits[11];
    bestMatrix[8 * size + 4] = fbits[10];
    bestMatrix[8 * size + 5] = fbits[9];
    bestMatrix[8 * size + 7] = fbits[8];
    bestMatrix[8 * size + 8] = fbits[7];
    bestMatrix[7 * size + 8] = fbits[6];
    bestMatrix[5 * size + 8] = fbits[5];
    bestMatrix[4 * size + 8] = fbits[4];
    bestMatrix[3 * size + 8] = fbits[3];
    bestMatrix[2 * size + 8] = fbits[2];
    bestMatrix[1 * size + 8] = fbits[1];
    bestMatrix[0 * size + 8] = fbits[0];
    // bottom-left (7 cells: bits 0..6)
    for (var bli = 0; bli <= 6; bli++) bestMatrix[(size - 1 - bli) * size + 8] = fbits[bli];
    // top-right (8 cells: bits 7..14, first at (8,size-8))
    for (var tri = 7; tri <= 14; tri++) bestMatrix[8 * size + (size - 15 + tri)] = fbits[tri];

    // place version info for v>=7
    if (version >= 7) {
      var vin = VERSION_INFO[version];
      for (var vji = 0; vji < 18; vji++) {
        var vb = (vin >> vji) & 1;
        var vr2 = Math.floor(vji / 3);
        var vc2 = (vji % 3) + size - 11;
        bestMatrix[vr2 * size + vc2] = vb;
        bestMatrix[vc2 * size + vr2] = vb;
      }
    }

    return {
      matrix: bestMatrix,
      size: size,
      version: version,
      ecLevel: ecLevel,
      mask: bestMask
    };
  }

  // ==================================================================
  // Rendering helpers (browser only - safely guarded)
  // ==================================================================
  function getCanvas() {
    return typeof document === 'undefined' ? null : document.createElement('canvas');
  }

  function renderToCanvas(canvasEl, qr, scale, quietZone) {
    scale = scale || 8;
    quietZone = quietZone || 4;
    var size = qr.size;
    var qz = quietZone * scale;
    var px = size * scale + qz * 2;
    canvasEl.width = px;
    canvasEl.height = px;
    var ctx = canvasEl.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#000000';
    var m = qr.matrix;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (m[r * size + c]) {
          ctx.fillRect(qz + c * scale, qz + r * scale, scale, scale);
        }
      }
    }
    return canvasEl;
  }

  function toImageUrl(qr, scale, quietZone) {
    var cv = getCanvas();
    if (!cv) return null;
    renderToCanvas(cv, qr, scale, quietZone);
    return cv.toDataURL('image/png');
  }

  function buildMatrix(text, ecLevel) {
    return createMatrix(text, ecLevel);
  }

  return {
    crc16: crc16,
    promptpayPayload: promptpayPayload,
    createMatrix: createMatrix,
    renderToCanvas: renderToCanvas,
    toImageUrl: toImageUrl,
    buildMatrix: buildMatrix,
    bch15_5: bch15_5
  };
});