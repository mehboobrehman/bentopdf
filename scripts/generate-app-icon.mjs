#!/usr/bin/env node
/**
 * Generates the "PDF Rotate Sync" application icon.
 *
 * - Saves the design as `PDF Rotate Sync Icon.png` (256x256, source design)
 * - Saves a multi-size Windows icon as `PDF Rotate Sync Icon.ico`
 *   (16x16, 24x24, 32x32, 48x48, 64x64, 128x128, 256x256; classic 32bpp DIB
 *   entries with AND masks, built with the resedit library that ships with
 *   this repo).
 *
 * Brand palette taken from the app's `public/images/favicon.svg`:
 * #6366F1 (main), #A5B4FC (light), #E0E7FF (lighter), #475569 (slate),
 * #FFFFFF (sheet).
 */
import { readFileSync, writeFileSync } from 'fs';
import { createCanvas } from '@napi-rs/canvas';
import { Data } from 'resedit';

const PNG_PATH = 'PDF Rotate Sync Icon.png';
const ICO_PATH = 'PDF Rotate Sync Icon.ico';
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const BRAND = { main: '#6366F1', light: '#A5B4FC', slate: '#475569', white: '#FFFFFF' };

/**
 * Draws the "PDF Rotate Sync" design onto the 2D context of a canvas.
 * Everything is opaque; the sheet is the main element, a folded top-right
 * tab and the wordmark "PDF" give the PDF feel, and a ring with arrowheads
 * gives the rotate/sync feel.
 */
function drawDesign(ctx, w, h) {
  const cx = w / 2;
  const cy = h * 0.5;

  // ---- Sheet (classic PDF document shape, white with slate border) ----
  const sheetX = w * 0.1;
  const sheetY = h * 0.08;
  const sheetW = w * 0.8;
  const sheetH = h * 0.72;
  const corner = sheetH * 0.07;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(sheetX, sheetY, sheetW, sheetH, corner);
  ctx.fillStyle = BRAND.white;
  ctx.fill();
  ctx.strokeStyle = BRAND.slate;
  ctx.lineWidth = Math.max(1, 0.03 * h);
  ctx.stroke();

  // ---- Folded corner tab (top-right) ----
  ctx.fillStyle = BRAND.light;
  ctx.beginPath();
  ctx.moveTo(sheetX + 0.66 * sheetW, sheetY + 0.06 * h);
  ctx.lineTo(sheetX + 0.98 * sheetW, sheetY + 0.06 * h);
  ctx.lineTo(sheetX + 0.98 * sheetW, sheetY + 0.34 * sheetH);
  ctx.closePath();
  ctx.fill();

  // ---- Sync ring + arrowheads (accent color) ----
  const r = 0.17 * h;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = BRAND.main;
  ctx.lineWidth = Math.max(1, 0.035 * h);
  ctx.lineCap = 'round';
  ctx.stroke();
  const len = 0.11 * h;
  const bw = 0.055 * h;
  ctx.fillStyle = BRAND.main;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r - len);
  ctx.lineTo(cx - bw, cy - r);
  ctx.lineTo(cx + bw, cy - r);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy + r + len);
  ctx.lineTo(cx - bw, cy + r);
  ctx.lineTo(cx + bw, cy + r);
  ctx.closePath();
  ctx.fill();

  // ---- "PDF" wordmark ----
  ctx.fillStyle = BRAND.slate;
  ctx.font = `bold ${Math.round(0.14 * h)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PDF', cx, sheetY + sheetH * 0.62);

  ctx.restore();
}

/**
 * Builds the classic 32bpp DIB (BITMAPINFOHEADER + XOR pixel rows + AND mask)
 * for one size from a canvas ImageData.
 *
 * Layout (matching the convention used by pixel-install.ico and resedit):
 *   header (40 bytes): biSize=40, biWidth=w, biHeight=2h, biPlanes=1,
 *                      biBitCount=32, biCompression=0, biSizeImage=w*h*4
 *   XOR data: h rows of w*4 bytes, bottom-up (first row = bottom row),
 *             pixel bytes B,G,R,A (alpha from the canvas; 255 = opaque)
 *   AND data: h rows of floor((w+31)/32)*4 bytes, bottom-up, bit i of the
 *             row = transparent for pixel i (MSB first); the design is
 *             opaque everywhere, so the AND mask is all zero.
 */
function buildDIB(img, w, h) {
  const rowBytes = w * 4;
  const andRowBytes = Math.floor((w + 31) / 32) * 4;
  const total = 40 + rowBytes * h + andRowBytes * h;
  const dib = Buffer.alloc(total);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(w, 4);
  dib.writeInt32LE(h * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16); // BI_RGB
  dib.writeUInt32LE(rowBytes * h, 20);
  dib.writeInt32LE(0, 24);
  dib.writeInt32LE(0, 28);
  dib.writeUInt32LE(0, 32);
  dib.writeUInt32LE(0, 36);
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y; // canvas rows are top-down; DIB rows are bottom-up
    const xorDst = 40 + y * rowBytes;
    for (let x = 0; x < w; x++) {
      const s = (srcY * w + x) * 4;
      const d = xorDst + x * 4;
      dib[d + 0] = img.data[s + 2]; // B
      dib[d + 1] = img.data[s + 1]; // G
      dib[d + 2] = img.data[s + 0]; // R
      dib[d + 3] = img.data[s + 3]; // A
      if (img.data[s + 3] === 0) {
        // Classic model: AND bit set = transparent punch-through.
        const bit = y * w + x;
        dib[40 + rowBytes * h + Math.floor(bit / 8)] |= 0x80 >> (bit % 8);
      }
    }
  }
  return dib;
}

function main() {
  // 1) PNG source design at 256x256
  const pngCanvas = createCanvas(256, 256);
  const pngCtx = pngCanvas.getContext('2d');
  drawDesign(pngCtx, 256, 256);
  writeFileSync(PNG_PATH, pngCanvas.toBuffer('image/png'));

  // 2) Multi-size ICO via resedit
  const iconFile = new Data.IconFile();
  iconFile.icons = SIZES.map((size) => {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    drawDesign(ctx, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    const dib = buildDIB(img, size, size);
    return {
      width: size,
      height: size,
      colors: 0,
      planes: 1,
      bitCount: 32,
      data: Data.IconItem.from(size, size, dib),
    };
  });
  writeFileSync(ICO_PATH, Buffer.from(iconFile.generate()));

  // 3) Validate the generated ICO by re-parsing it
  const parsed = Data.IconFile.from(readFileSync(ICO_PATH));
  console.log(`wrote ${PNG_PATH} (256x256) and ${ICO_PATH}`);
  console.log(`validated ${ICO_PATH}: ${parsed.icons.length} icons:`);
  for (const icon of parsed.icons) {
    console.log(`  ${icon.width || 256}x${icon.height || 256}/${icon.bitCount}bpp pixels=${icon.data.pixels.byteLength}B`);
  }
}

main();
