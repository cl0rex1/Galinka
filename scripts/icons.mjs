import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const svg = await readFile('public/icon.svg');
for (const size of [192, 512])
  await writeFile(
    `public/icon-${size}.png`,
    new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng(),
  );

for (const [density, size] of [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]) {
  const directory = `android/app/src/main/res/mipmap-${density}`;
  await mkdir(directory, { recursive: true });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  for (const name of ['ic_launcher', 'ic_launcher_round'])
    await writeFile(`${directory}/${name}.png`, png);
  const foreground = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><g transform="translate(32 32)">${svg.toString().replace(/<\/?svg[^>]*>/g, '')}</g></svg>`,
  );
  await writeFile(
    `${directory}/ic_launcher_foreground.png`,
    new Resvg(foreground, { fitTo: { mode: 'width', value: size * 2.25 } }).render().asPng(),
  );
}
