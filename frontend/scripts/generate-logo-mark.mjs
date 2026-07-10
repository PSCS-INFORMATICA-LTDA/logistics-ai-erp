import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const input = path.join(__dirname, "../public/grx-logo.png");
const output = path.join(__dirname, "../public/grx-logo-mark.png");

const WHITE_BG_THRESHOLD = 235;

function isBrandRed(r, g, b) {
  return r > 110 && r > g * 1.35 && r > b * 1.35 && g < 160 && b < 160;
}

function isNearWhite(r, g, b) {
  return r >= WHITE_BG_THRESHOLD && g >= WHITE_BG_THRESHOLD && b >= WHITE_BG_THRESHOLD;
}

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

for (let i = 0; i < data.length; i += 4) {
  let r = data[i];
  let g = data[i + 1];
  let b = data[i + 2];

  if (isNearWhite(r, g, b)) {
    data[i + 3] = 0;
    continue;
  }

  if (isBrandRed(r, g, b)) {
    continue;
  }

  // Elipse, linhas e tagline: preto/cinza → branco para contraste no menu escuro
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance < 200) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
}

await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .png()
  .toFile(output);

console.log("Gerado (menu escuro):", output, `${info.width}x${info.height}`);
