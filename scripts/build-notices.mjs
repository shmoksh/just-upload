// Writes public/licenses/THIRD_PARTY_NOTICES.txt: the full license text of every
// third-party package bundled into the extension. It ships inside the extension so the
// notices always travel with the code, as the MIT and LGPL licenses require.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
/** Resolves a package directory even when it is only a transitive dependency. */
function packageDir(name, from = root) {
  const local = createRequire(join(from, 'package.json'));
  try {
    return dirname(local.resolve(`${name}/package.json`));
  } catch {
    // Some packages don't export their package.json: walk up from the entry point.
    let dir = dirname(local.resolve(name));
    while (dir !== dirname(dir)) {
      const manifest = join(dir, 'package.json');
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name)
        return dir;
      dir = dirname(dir);
    }
    throw new Error(`Cannot find the package directory of ${name}`);
  }
}

const shipped = [
  { name: 'react', where: 'Extension pages (popup, settings, welcome)' },
  { name: 'react-dom', where: 'Extension pages (popup, settings, welcome)' },
  { name: 'scheduler', parent: 'react-dom', where: 'Extension pages, via react-dom' },
  { name: 'framer-motion', where: 'Extension pages (animation)' },
  { name: 'motion-dom', parent: 'framer-motion', where: 'Extension pages, via framer-motion' },
  { name: 'motion-utils', parent: 'framer-motion', where: 'Extension pages, via framer-motion' },
  { name: 'pica', where: 'Image worker (resizing)' },
  { name: 'glur', parent: 'pica', where: 'Image worker, via pica' },
  { name: 'multimath', parent: 'pica', where: 'Image worker, via pica' },
  { name: 'libheif-js', where: 'vendor/libheif.mjs (HEIC decoding), a separate replaceable file' },
  { name: 'gifenc', where: 'Image worker (GIF writing)' },
  { name: 'utif2', where: 'Image worker (TIFF reading and writing), loaded on demand' },
  { name: 'pako', where: 'Image worker, used by utif2 for compressed TIFF' },
  {
    name: '@jsquash/avif',
    where: 'Image worker (AVIF writing: libavif, libaom, libsharpyuv), loaded on demand',
  },
  {
    name: '@jsquash/jxl',
    where: 'Image worker (JPEG XL reading: libjxl, highway, skcms, brotli), loaded on demand',
  },
  { name: 'pdf-lib', where: 'Image worker (writing and shrinking PDFs), loaded on demand' },
  { name: '@pdf-lib/standard-fonts', parent: 'pdf-lib', where: 'Image worker, via pdf-lib' },
  { name: '@pdf-lib/upng', parent: 'pdf-lib', where: 'Image worker, via pdf-lib (PNG reading)' },
  { name: 'tslib', parent: 'pdf-lib', where: 'Image worker, via pdf-lib' },
  {
    name: 'pdfjs-dist',
    where: 'Extension page (drawing PDF pages) and vendor/pdf.worker.min.mjs, loaded on demand',
  },
  {
    name: 'xlsx',
    where: 'Image worker (reading and writing CSV and Excel files), loaded on demand',
  },
];

/** Libraries compiled into the WebAssembly codecs above, with their license and patent texts. */
const embedded = [
  ['libheif (inside libheif-js)', 'libheif-LICENSE.txt'],
  ['libde265 (inside libheif-js)', 'libde265-LICENSE.txt'],
  ['libavif 1.0.1 (inside @jsquash/avif)', 'libavif-LICENSE.txt'],
  ['libaom (inside @jsquash/avif)', 'libaom-LICENSE.txt'],
  ['libaom: Alliance for Open Media Patent License 1.0', 'libaom-PATENTS.txt'],
  ['libsharpyuv, part of libwebp (inside @jsquash/avif)', 'libwebp-sharpyuv-COPYING.txt'],
  ['libwebp: additional IP rights grant', 'libwebp-sharpyuv-PATENTS.txt'],
  ['libjxl (inside @jsquash/jxl)', 'libjxl-LICENSE.txt'],
  ['libjxl: patent grant', 'libjxl-PATENTS.txt'],
  ['highway (inside @jsquash/jxl)', 'highway-LICENSE.txt'],
  ['skcms (inside @jsquash/jxl)', 'skcms-LICENSE.txt'],
  ['brotli (inside @jsquash/jxl)', 'brotli-LICENSE.txt'],
];

/** Files shipped as they are: the display typeface of the extension's own pages. */
const assets = [
  [
    'Instrument Serif (fonts/instrument-serif-*.woff2), SIL Open Font License 1.1. Used on the extension pages only.',
    'InstrumentSerif-OFL.txt',
  ],
];

function licenseText(dir) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    if (existsSync(join(dir, name))) return readFileSync(join(dir, name), 'utf8').trim();
  }
  throw new Error(`No license file in ${dir}`);
}

const sections = [
  'Just Upload bundles the following third-party software. Each license text follows.',
  '',
  'The HEIC decoder (libheif-js, containing libheif and libde265) is free software under',
  'the GNU Lesser General Public License, version 3. Copies of that license and of the GNU',
  'General Public License are below. It ships unmodified, as the separate file',
  'vendor/libheif.mjs. You may modify it, replace it in your copy of the extension with a',
  'modified version that keeps the same interface, and reverse engineer the extension to',
  'debug such modifications. Its exact source code, and how to replace it:',
  '  https://github.com/shmoksh/just-upload/tree/main/docs/decoder-source',
  '  https://github.com/shmoksh/just-upload/blob/main/docs/heic-licensing.md',
  'libheif: Copyright (c) 2017-2025 Dirk Farin and contributors, including struktur AG.',
  'libde265: Copyright (c) 2013-2014 struktur AG, Dirk Farin.',
  '',
];
for (const item of shipped) {
  const dir = item.parent ? packageDir(item.name, packageDir(item.parent)) : packageDir(item.name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const license = licenseText(dir);
  sections.push(
    '='.repeat(78),
    `${pkg.name} ${pkg.version} (${pkg.license})`,
    `Used in: ${item.where}`,
    '='.repeat(78),
    '',
    license,
    '',
  );
}
for (const [name, file] of [...embedded, ...assets]) {
  const text = readFileSync(join(root, 'docs/licenses', file), 'utf8').trim();
  sections.push('='.repeat(78), name, '='.repeat(78), '', text, '');
}

const out = join(root, 'public/licenses');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'THIRD_PARTY_NOTICES.txt'), `${sections.join('\n')}\n`);
console.log(
  `Wrote notices for ${shipped.length} packages, ${embedded.length} embedded components and ${assets.length} font.`,
);
