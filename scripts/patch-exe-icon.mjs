#!/usr/bin/env node
/**
 * Applies `PDF Rotate Sync Icon.ico` as the icon of `release/BentoPDF-0.0.0-portable.exe`.
 *
 * Uses the `resedit` library (the same one Electron Builder uses to set icons
 * on Windows builds) to:
 *   1. dump the current icon groups of the exe,
 *   2. replace the largest group's icons with the new multi-size set,
 *   3. verify by re-parsing the patched exe and rendering the largest icon
 *      back to a PNG for visual inspection.
 */
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

const EXE_PATH = process.argv[2] || 'release/BentoPDF-0.0.0-portable.exe';
const ICO_PATH = 'PDF Rotate Sync Icon.ico';
const EXTRACT_PNG_PATH = `/tmp/opencode/patched-icon-${basename(EXE_PATH, '.exe')}.png`;

function dumpGroups(res, label) {
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  console.log(`${label}: ${groups.length} icon group(s)`);
  for (const g of groups) {
    const icons = g.icons.map((i) => `${i.width || 256}x${i.height || 256}/${i.bitCount}bpp(id=${i.iconID})`).join(', ');
    console.log(`  group id=${g.id} lang=${g.lang}: [${icons}]`);
  }
  return groups;
}

function main() {
  const ico = Data.IconFile.from(readFileSync(ICO_PATH));
  console.log(
    `ICO ${ICO_PATH}: ${ico.icons.length} icons: ` +
      ico.icons.map((i) => `${i.width || 256}x${i.height || 256}/${i.bitCount}bpp`).join(', '),
  );

  const exe = NtExecutable.from(readFileSync(EXE_PATH));
  const res = NtExecutableResource.from(exe);
  const groups = dumpGroups(res, 'before');

  // Replace the group with the most icons (the app's main icon group)
  let target = groups.reduce((best, g) => (!best || g.icons.length > best.icons.length ? g : best), null);
  if (!target) {
    console.log('no existing icon group found; appending a new one with id=1 lang=1033');
    target = { id: 1, lang: 0x409 };
  }
  console.log(`replacing icon group id=${target.id} lang=${target.lang}`);
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, ico.icons.map((i) => i.data));
  res.outputResource(exe);
  writeFileSync(EXE_PATH, Buffer.from(exe.generate()));
  console.log(`exe patched: ${EXE_PATH}`);

  // Verify: re-parse and dump the groups
  const exe2 = NtExecutable.from(readFileSync(EXE_PATH));
  const res2 = NtExecutableResource.from(exe2);
  const groups2 = dumpGroups(res2, 'after');

  // Extract the largest icon of the patched group back to PNG for visual check
  const target2 = groups2.find((g) => g.id === target.id && g.lang === target.lang) || groups2[0];
  if (!target2) {
    console.log('verification skipped: no icon groups after patching');
    return;
  }
  const items = target2.getIconItemsFromEntries(res2.entries);
  const icons = items.filter((i) => i.isIcon());
  if (icons.length === 0) {
    console.log('verification skipped: no DIB icon data found');
    return;
  }
  const largest = icons.reduce((best, i) => (i.bitmapInfo.width > best.bitmapInfo.width ? i : best));
  const w = largest.bitmapInfo.width;
  const h = largest.bitmapInfo.height / 2;
  const pixelBuf = new Uint8Array(largest.pixels);
  const maskBuf = largest.masks || new ArrayBuffer(0);
  const pixels = new Uint8ClampedArray(w * h * 4);
  const maskView = new Uint8Array(maskBuf);
  for (let y = 0; y < h; y++) {
    const srcRow = h - 1 - y; // bottom-up DIB rows
    for (let x = 0; x < w; x++) {
      const sp = srcRow * w * 4 + x * 4;
      const bit = srcRow * w + x;
      const transparent = (maskBuf.byteLength ? maskView[Math.floor(bit / 8)] & (0x80 >> (bit % 8)) : 0) !== 0;
      const dp = (y * w + x) * 4;
      pixels[dp + 0] = pixelBuf[sp + 2]; // R
      pixels[dp + 1] = pixelBuf[sp + 1]; // G
      pixels[dp + 2] = pixelBuf[sp + 0]; // B
      pixels[dp + 3] = transparent ? 0 : pixelBuf[sp + 3];
    }
  }
  const vcanvas = createCanvas(w, h);
  vcanvas.getContext('2d').putImageData(new ImageData(pixels, w, h), 0, 0);
  writeFileSync(EXTRACT_PNG_PATH, vcanvas.toBuffer('image/png'));
  console.log(`extracted largest icon (${w}x${h}) to ${EXTRACT_PNG_PATH}`);
}

main();
