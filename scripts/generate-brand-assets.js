'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = path.join(os.homedir(), 'Downloads', 'MEP-lab-ICON.png');
const SOURCE_IMAGE = path.resolve(process.env.MEP_LAB_LOGO_SOURCE || DEFAULT_SOURCE);
const TEMP_DIR = path.join(PROJECT_ROOT, '.tmp', 'brand-assets');
const ICON_CONTENT_FILL_RATIO = 0.86;

const PNG_TARGETS = [
  { path: 'resources/icon.png', width: 1024, height: 1024 },
  { path: 'resources/logo.png', width: 1024, height: 1024 },
  { path: 'public/logo.png', width: 1024, height: 1024 },
  { path: 'src/renderer/assets/logo.png', width: 1024, height: 1024 },
  { path: 'website/public/logo.png', width: 1024, height: 1024 },
  { path: 'public/favicon.png', width: 32, height: 32 },
  { path: 'resources/tray-icon.png', width: 32, height: 32 },
  { path: 'resources/tray-iconTemplate.png', width: 32, height: 32 },
  { path: 'resources/social-preview.png', width: 1200, height: 630 },
  { path: 'website/public/og-image.png', width: 1200, height: 630 },
];

const ICONSET_TARGETS = [
  { path: 'resources/icon.iconset/icon_16x16.png', width: 16, height: 16 },
  { path: 'resources/icon.iconset/icon_16x16@2x.png', width: 32, height: 32 },
  { path: 'resources/icon.iconset/icon_32x32.png', width: 32, height: 32 },
  { path: 'resources/icon.iconset/icon_32x32@2x.png', width: 64, height: 64 },
  { path: 'resources/icon.iconset/icon_128x128.png', width: 128, height: 128 },
  { path: 'resources/icon.iconset/icon_128x128@2x.png', width: 256, height: 256 },
  { path: 'resources/icon.iconset/icon_256x256.png', width: 256, height: 256 },
  { path: 'resources/icon.iconset/icon_256x256@2x.png', width: 512, height: 512 },
  { path: 'resources/icon.iconset/icon_512x512.png', width: 512, height: 512 },
  { path: 'resources/icon.iconset/icon_512x512@2x.png', width: 1024, height: 1024 },
];

const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const ICNS_SPECS = [
  { type: 'icp4', size: 16 },
  { type: 'icp5', size: 32 },
  { type: 'icp6', size: 64 },
  { type: 'ic07', size: 128 },
  { type: 'ic08', size: 256 },
  { type: 'ic09', size: 512 },
  { type: 'ic10', size: 1024 },
];

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function writePngsWithPowerShell(targets) {
  const script = `
Add-Type -AssemblyName System.Drawing
$source = ${psQuote(SOURCE_IMAGE)}
$contentFillRatio = ${ICON_CONTENT_FILL_RATIO}
if (-not (Test-Path -LiteralPath $source)) {
  throw "Source image not found: $source"
}
function Get-VisibleBounds {
  param([System.Drawing.Bitmap]$Image)
  $minX = $Image.Width
  $minY = $Image.Height
  $maxX = -1
  $maxY = -1
  for ($y = 0; $y -lt $Image.Height; $y++) {
    for ($x = 0; $x -lt $Image.Width; $x++) {
      $pixel = $Image.GetPixel($x, $y)
      if ($pixel.A -gt 10) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($maxX -lt 0) {
    return New-Object System.Drawing.Rectangle 0, 0, $Image.Width, $Image.Height
  }
  return New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
}
function Get-BrandSourceRect {
  param(
    [System.Drawing.Bitmap]$Image,
    [System.Drawing.Rectangle]$Bounds
  )
  $largestAxis = [Math]::Max($Bounds.Width, $Bounds.Height)
  $squareSize = [Math]::Ceiling($largestAxis / $contentFillRatio)
  $squareSize = [Math]::Min([Math]::Min($Image.Width, $Image.Height), $squareSize)
  $centerX = $Bounds.X + ($Bounds.Width / 2)
  $centerY = $Bounds.Y + ($Bounds.Height / 2)
  $sourceX = [Math]::Round($centerX - ($squareSize / 2))
  $sourceY = [Math]::Round($centerY - ($squareSize / 2))
  if ($sourceX -lt 0) { $sourceX = 0 }
  if ($sourceY -lt 0) { $sourceY = 0 }
  if (($sourceX + $squareSize) -gt $Image.Width) { $sourceX = $Image.Width - $squareSize }
  if (($sourceY + $squareSize) -gt $Image.Height) { $sourceY = $Image.Height - $squareSize }
  return New-Object System.Drawing.Rectangle $sourceX, $sourceY, $squareSize, $squareSize
}
function Write-BrandPng {
  param(
    [string]$Target,
    [int]$Width,
    [int]$Height,
    [System.Drawing.Bitmap]$SourceImage,
    [System.Drawing.Rectangle]$SourceRect
  )
  $directory = Split-Path -Parent $Target
  if ($directory) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  $bitmap = New-Object System.Drawing.Bitmap $Width, $Height
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $scale = [Math]::Min($Width / $SourceRect.Width, $Height / $SourceRect.Height)
      $drawWidth = [Math]::Round($SourceRect.Width * $scale)
      $drawHeight = [Math]::Round($SourceRect.Height * $scale)
      $x = [Math]::Round(($Width - $drawWidth) / 2)
      $y = [Math]::Round(($Height - $drawHeight) / 2)
      $destinationRect = New-Object System.Drawing.Rectangle $x, $y, $drawWidth, $drawHeight
      $graphics.DrawImage(
        $SourceImage,
        $destinationRect,
        $SourceRect.X,
        $SourceRect.Y,
        $SourceRect.Width,
        $SourceRect.Height,
        [System.Drawing.GraphicsUnit]::Pixel
      )
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
}
$sourceImage = [System.Drawing.Bitmap]::FromFile($source)
try {
  $visibleBounds = Get-VisibleBounds -Image $sourceImage
  $sourceRect = Get-BrandSourceRect -Image $sourceImage -Bounds $visibleBounds
${targets
  .map(
    (target) =>
      `  Write-BrandPng -Target ${psQuote(path.resolve(PROJECT_ROOT, target.path))} -Width ${target.width} -Height ${target.height} -SourceImage $sourceImage -SourceRect $sourceRect`
  )
  .join('\n')}
} finally {
  $sourceImage.Dispose()
}
`;

  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    stdio: 'inherit',
  });
}

function writeIco(pngEntries, targetPath) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngEntries.length, 4);

  const directory = Buffer.alloc(16 * pngEntries.length);
  let offset = header.length + directory.length;

  pngEntries.forEach((entry, index) => {
    const dirOffset = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, dirOffset);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, dirOffset + 1);
    directory.writeUInt8(0, dirOffset + 2);
    directory.writeUInt8(0, dirOffset + 3);
    directory.writeUInt16LE(1, dirOffset + 4);
    directory.writeUInt16LE(32, dirOffset + 6);
    directory.writeUInt32LE(entry.buffer.length, dirOffset + 8);
    directory.writeUInt32LE(offset, dirOffset + 12);
    offset += entry.buffer.length;
  });

  ensureDir(targetPath);
  fs.writeFileSync(targetPath, Buffer.concat([header, directory, ...pngEntries.map((entry) => entry.buffer)]));
}

function writeIcns(pngEntries, targetPath) {
  const chunks = pngEntries.map((entry) => {
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write(entry.type, 0, 4, 'ascii');
    chunkHeader.writeUInt32BE(entry.buffer.length + 8, 4);
    return Buffer.concat([chunkHeader, entry.buffer]);
  });
  const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalLength, 4);

  ensureDir(targetPath);
  fs.writeFileSync(targetPath, Buffer.concat([header, ...chunks]));
}

function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const icoTargets = ICO_SIZES.map((size) => ({
    path: path.relative(PROJECT_ROOT, path.join(TEMP_DIR, `ico-${size}.png`)),
    width: size,
    height: size,
  }));
  const icnsTargets = ICNS_SPECS.map((entry) => ({
    path: path.relative(PROJECT_ROOT, path.join(TEMP_DIR, `icns-${entry.size}.png`)),
    width: entry.size,
    height: entry.size,
  }));

  writePngsWithPowerShell([...PNG_TARGETS, ...ICONSET_TARGETS, ...icoTargets, ...icnsTargets]);

  writeIco(
    ICO_SIZES.map((size) => ({
      size,
      buffer: fs.readFileSync(path.join(TEMP_DIR, `ico-${size}.png`)),
    })),
    path.join(PROJECT_ROOT, 'resources', 'icon.ico')
  );

  writeIcns(
    ICNS_SPECS.map((entry) => ({
      type: entry.type,
      buffer: fs.readFileSync(path.join(TEMP_DIR, `icns-${entry.size}.png`)),
    })),
    path.join(PROJECT_ROOT, 'resources', 'icon.icns')
  );

  console.log(`Generated MEP Lab brand assets from ${SOURCE_IMAGE}`);
}

if (require.main === module) {
  main();
}
