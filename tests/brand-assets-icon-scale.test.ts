import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';

type PngImage = {
  width: number;
  height: number;
  rgba: Buffer;
};

function parsePng(filePath: string): PngImage {
  const buffer = fs.readFileSync(filePath);
  const signature = buffer.subarray(0, 8).toString('hex');
  expect(signature).toBe('89504e470d0a1a0a');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data.readUInt8(9);
      expect(data.readUInt8(8)).toBe(8);
      expect(colorType).toBe(6);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const rgba = Buffer.alloc(width * height * bytesPerPixel);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = inflated[rowStart];
    const current = inflated.subarray(rowStart + 1, rowStart + 1 + stride);
    const previous = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : undefined;
    const output = rgba.subarray(y * stride, (y + 1) * stride);

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? output[x - bytesPerPixel] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      const paeth = (() => {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        if (pa <= pb && pa <= pc) return left;
        if (pb <= pc) return up;
        return upLeft;
      })();

      if (filter === 0) output[x] = current[x];
      else if (filter === 1) output[x] = (current[x] + left) & 0xff;
      else if (filter === 2) output[x] = (current[x] + up) & 0xff;
      else if (filter === 3) output[x] = (current[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) output[x] = (current[x] + paeth) & 0xff;
      else throw new Error(`Unsupported PNG filter: ${filter}`);
    }
  }

  return { width, height, rgba };
}

function alphaBounds(image: PngImage, threshold = 10) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.rgba[(y * image.width + x) * 4 + 3];
      if (alpha > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0) {
    throw new Error('PNG has no visible pixels');
  }

  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

describe('brand asset icon scale', () => {
  it('keeps taskbar-sized icon artwork large enough in the 32px icon asset', () => {
    const icon = parsePng(
      path.resolve(process.cwd(), 'resources/icon.iconset/icon_32x32.png')
    );
    const bounds = alphaBounds(icon);
    const largestAxisFill = Math.max(bounds.width / icon.width, bounds.height / icon.height);

    expect(largestAxisFill).toBeGreaterThanOrEqual(0.8);
  });
});
