const BRAND_LOGO_PATH = "/grx-logo.png";
const DEFAULT_PUBLIC_APP_URL = "https://grx-management.vercel.app";
const DEFAULT_COMPANY_TAGLINE = "GRX Transportes e Logística";

const PLAQUE_LOGO_WIDTH = 220;
const PLAQUE_PAD_X = 22;
const PLAQUE_PAD_Y = 16;
const PLAQUE_RADIUS = 12;
const PLAQUE_SHADOW_PAD = 14;
const PLAQUE_RENDER_SCALE = 2;
/** Mesmas camadas do BrandLogo (variant plaque3d, full). */
const LOGO_DEPTH_LAYERS = [5, 4, 3, 2, 1] as const;
const DEPTH_OFFSET_PX = 1.35;
/** Keep embedded logo small — ClipboardItem + QR HTML must stay under browser limits. */
const MAX_EMAIL_EMBEDDED_LOGO_CHARS = 64_000;

let cachedBrandLogoPlaque3D: string | null = null;
let cachedBrandLogoPlaqueVersion = 0;
const PLAQUE_CACHE_VERSION = 4;

function resolveOrigin(origin?: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (origin?.trim()) return origin.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return DEFAULT_PUBLIC_APP_URL;
}

export function getBrandLogoPublicUrl(origin?: string): string {
  return `${resolveOrigin(origin)}${BRAND_LOGO_PATH}`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPlaqueBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  withDropShadow = false
): void {
  if (withDropShadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.42)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
    roundRectPath(ctx, 0.5, 0.5, width - 1, height - 1, PLAQUE_RADIUS);
    ctx.fillStyle = "#0a0a0a";
    ctx.fill();
    ctx.restore();
  }

  roundRectPath(ctx, 0.5, 0.5, width - 1, height - 1, PLAQUE_RADIUS);

  const gradient = ctx.createLinearGradient(0, 0, width * 0.35, height);
  gradient.addColorStop(0, "#181818");
  gradient.addColorStop(0.52, "#0a0a0a");
  gradient.addColorStop(1, "#050505");
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, 1, 1, width - 2, height - 2, PLAQUE_RADIUS - 1);
  const highlight = ctx.createLinearGradient(0, 0, width, height * 0.6);
  highlight.addColorStop(0, "rgba(255, 255, 255, 0.07)");
  highlight.addColorStop(0.38, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = highlight;
  ctx.fill();
  ctx.restore();

  const accentY = height - 6;
  const accent = ctx.createLinearGradient(width * 0.15, accentY, width * 0.85, accentY);
  accent.addColorStop(0, "rgba(208, 0, 31, 0)");
  accent.addColorStop(0.5, "rgba(208, 0, 31, 0.35)");
  accent.addColorStop(1, "rgba(208, 0, 31, 0)");
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width * 0.12, accentY);
  ctx.lineTo(width * 0.88, accentY);
  ctx.stroke();
}

function loadImageFromObjectUrl(objectUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("logo load failed"));
    image.src = objectUrl;
  });
}

function loadImageDirect(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image.naturalWidth > 0 ? image : null);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function loadBrandLogoImage(origin?: string): Promise<HTMLImageElement | null> {
  if (typeof window === "undefined") return null;

  const domImg = document.querySelector<HTMLImageElement>(
    ".brand-logo-3d-stack img, .brand-logo-plaque img, .proposal-logo img"
  );
  if (domImg?.complete && domImg.naturalWidth > 0) {
    return domImg;
  }
  if (domImg?.src) {
    const fromDom = await loadImageDirect(domImg.src);
    if (fromDom) return fromDom;
  }

  const candidates: string[] = [];
  candidates.push(BRAND_LOGO_PATH);
  if (window.location.origin) {
    candidates.push(`${window.location.origin}${BRAND_LOGO_PATH}`);
  }
  candidates.push(getBrandLogoPublicUrl(origin));
  candidates.push(getBrandLogoPublicUrl(window.location.origin));

  const seen = new Set<string>();
  for (const logoUrl of candidates) {
    if (seen.has(logoUrl)) continue;
    seen.add(logoUrl);

    const direct = await loadImageDirect(logoUrl);
    if (direct) return direct;

    try {
      const response = await fetch(logoUrl);
      if (!response.ok) continue;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = await loadImageFromObjectUrl(objectUrl);
        if (image.naturalWidth > 0) return image;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      /* tenta próxima origem */
    }
  }

  return null;
}

function exportCanvasToDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    const png = canvas.toDataURL("image/png");
    if (png.length <= MAX_EMAIL_EMBEDDED_LOGO_CHARS) return png;

    for (const quality of [0.92, 0.84, 0.76, 0.68, 0.6, 0.52]) {
      const jpeg = canvas.toDataURL("image/jpeg", quality);
      if (jpeg.length <= MAX_EMAIL_EMBEDDED_LOGO_CHARS) return jpeg;
    }
  } catch {
    return null;
  }
  return null;
}

function compressCanvasToEmailDataUrl(canvas: HTMLCanvasElement): string | null {
  let result = exportCanvasToDataUrl(canvas);
  if (result) return result;

  let source: HTMLCanvasElement | HTMLImageElement = canvas;
  let width = canvas.width;
  let height = canvas.height;

  for (let step = 0; step < 4; step += 1) {
    width = Math.max(120, Math.round(width * 0.86));
    height = Math.max(48, Math.round(height * 0.86));
    const scaled = document.createElement("canvas");
    scaled.width = width;
    scaled.height = height;
    const ctx = scaled.getContext("2d");
    if (!ctx) break;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    result = exportCanvasToDataUrl(scaled);
    if (result) return result;
    source = scaled;
  }

  try {
    return canvas.toDataURL("image/jpeg", 0.48);
  } catch {
    return null;
  }
}

function drawLogo3DStack(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement,
  baseX: number,
  baseY: number,
  logoWidth: number,
  logoHeight: number
): void {
  const centerX = baseX + logoWidth / 2;
  const centerY = baseY + logoHeight / 2;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.transform(1, 0.08, -0.12, 0.9, 0, 0);
  ctx.translate(-centerX, -centerY);

  for (const depth of [...LOGO_DEPTH_LAYERS].reverse()) {
    const offset = depth * DEPTH_OFFSET_PX;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.filter = "brightness(0.28) saturate(1.1)";
    ctx.drawImage(source, baseX + offset + 1.5, baseY + offset + 1.5, logoWidth, logoHeight);
    ctx.restore();
  }

  for (const depth of LOGO_DEPTH_LAYERS) {
    const offset = depth * DEPTH_OFFSET_PX;
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, 1 - depth * 0.07);
    ctx.globalCompositeOperation = "lighten";
    ctx.filter = "brightness(0.52) saturate(1.2)";
    ctx.drawImage(source, baseX + offset, baseY + offset, logoWidth, logoHeight);
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "rgba(208, 0, 31, 0.45)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = -2;
  ctx.shadowOffsetY = -2;
  ctx.drawImage(source, baseX, baseY, logoWidth, logoHeight);
  ctx.restore();

  ctx.restore();
}

/** Renderiza o logo padrão 3D (placa escura + profundidade) para colar em e-mails. */
export function renderBrandLogoPlaque3DToDataUrl(source: HTMLImageElement): string | null {
  if (typeof document === "undefined") return null;

  const logoWidth = PLAQUE_LOGO_WIDTH;
  const logoHeight = Math.max(1, Math.round((source.naturalHeight / source.naturalWidth) * logoWidth));
  const plaqueWidth = logoWidth + PLAQUE_PAD_X * 2;
  const plaqueHeight = logoHeight + PLAQUE_PAD_Y * 2;
  const totalWidth = plaqueWidth + PLAQUE_SHADOW_PAD * 2;
  const totalHeight = plaqueHeight + PLAQUE_SHADOW_PAD * 2;

  const canvas = document.createElement("canvas");
  canvas.width = totalWidth * PLAQUE_RENDER_SCALE;
  canvas.height = totalHeight * PLAQUE_RENDER_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(PLAQUE_RENDER_SCALE, PLAQUE_RENDER_SCALE);
  ctx.translate(PLAQUE_SHADOW_PAD, PLAQUE_SHADOW_PAD);
  drawPlaqueBackground(ctx, plaqueWidth, plaqueHeight, true);
  drawLogo3DStack(ctx, source, PLAQUE_PAD_X, PLAQUE_PAD_Y, logoWidth, logoHeight);

  return compressCanvasToEmailDataUrl(canvas);
}

export async function fetchBrandLogoDataUrl(origin?: string): Promise<string | null> {
  if (
    cachedBrandLogoPlaque3D?.startsWith("data:image") &&
    cachedBrandLogoPlaqueVersion === PLAQUE_CACHE_VERSION
  ) {
    return cachedBrandLogoPlaque3D;
  }

  try {
    const image = await loadBrandLogoImage(origin);
    if (image) {
      const plaque3d = renderBrandLogoPlaque3DToDataUrl(image);
      if (plaque3d?.startsWith("data:image")) {
        cachedBrandLogoPlaque3D = plaque3d;
        cachedBrandLogoPlaqueVersion = PLAQUE_CACHE_VERSION;
        return plaque3d;
      }
    }
  } catch {
    /* fallback abaixo */
  }

  return null;
}

export function buildEmailBrandFooterHtml(
  logoSrc: string | null,
  companyName = DEFAULT_COMPANY_TAGLINE
): string {
  const safeCompany = companyName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  if (!logoSrc?.startsWith("data:image")) {
    return [
      `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:left">`,
      `<p style="margin:0;font-size:11px;color:#64748b;letter-spacing:0.06em;text-transform:uppercase">${safeCompany}</p>`,
      `</div>`,
    ].join("");
  }

  const logoBlock = [
    `<img src="${logoSrc}" alt="${safeCompany}" width="264" style="display:block;max-width:264px;height:auto;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,0.28),0 4px 10px rgba(208,0,31,0.08)" />`,
  ].join("");

  return [
    `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:left">`,
    logoBlock,
    `<p style="margin:12px 0 0;font-size:11px;color:#64748b;letter-spacing:0.06em;text-transform:uppercase">${safeCompany}</p>`,
    `</div>`,
  ].join("");
}

/** Apenas placa 3D embutida (data URL) — nunca URL plana de /grx-logo.png. */
export function resolveEmailBrandLogoSrc(logoDataUrl: string | null): string | null {
  return logoDataUrl?.startsWith("data:image") ? logoDataUrl : null;
}
