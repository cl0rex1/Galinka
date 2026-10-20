import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile } from 'node:fs/promises';
const svg = await readFile('public/icon.svg');
for (const size of [192, 512])
  await writeFile(
    `public/icon-${size}.png`,
    new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng(),
  );
