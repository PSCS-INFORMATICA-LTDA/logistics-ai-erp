const BRAND_LOGO_PATH = "/grx-logo.png";
const DEFAULT_PUBLIC_APP_URL = "https://grx-management.vercel.app";
const DEFAULT_COMPANY_TAGLINE = "GRX Transportes e Logística";

const PLAQUE_LOGO_WIDTH = 200;
const PLAQUE_PAD_X = 20;
const PLAQUE_PAD_Y = 14;
const PLAQUE_RADIUS = 12;
const LOGO_DEPTH_LAYERS = [2, 1] as const;

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
  height: number
): void {
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

async function loadBrandLogoImage(origin?: string): Promise<HTMLImageElement | null> {
  if (typeof window === "undefined") return null;

  const candidates = new Set<string>();
  candidates.add(getBrandLogoPublicUrl(origin));
  candidates.add(getBrandLogoPublicUrl(window.location.origin));

  for (const logoUrl of candidates) {
    try {
      const image = new window.Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("logo load failed"));
        image.src = logoUrl;
      });
      if (image.naturalWidth > 0) return image;
    } catch {
      /* tenta próxima origem */
    }
  }

  return null;
}

/** Renderiza o logo padrão 3D (placa escura + profundidade) para colar em e-mails. */
export function renderBrandLogoPlaque3DToDataUrl(source: HTMLImageElement): string | null {
  if (typeof document === "undefined") return null;

  const logoWidth = PLAQUE_LOGO_WIDTH;
  const logoHeight = Math.max(1, Math.round((source.naturalHeight / source.naturalWidth) * logoWidth));
  const plaqueWidth = logoWidth + PLAQUE_PAD_X * 2;
  const plaqueHeight = logoHeight + PLAQUE_PAD_Y * 2;

  const canvas = document.createElement("canvas");
  canvas.width = plaqueWidth;
  canvas.height = plaqueHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  drawPlaqueBackground(ctx, plaqueWidth, plaqueHeight);

  const baseX = PLAQUE_PAD_X;
  const baseY = PLAQUE_PAD_Y;

  for (const depth of LOGO_DEPTH_LAYERS) {
    const offset = depth * 1.1;
    ctx.save();
    ctx.globalAlpha = Math.max(0.2, 1 - depth * 0.08);
    ctx.filter = "brightness(0.55) saturate(1.15)";
    ctx.drawImage(source, baseX + offset, baseY + offset, logoWidth, logoHeight);
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor = "rgba(208, 0, 31, 0.28)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.drawImage(source, baseX, baseY, logoWidth, logoHeight);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

export async function fetchBrandLogoDataUrl(origin?: string): Promise<string | null> {
  const image = await loadBrandLogoImage(origin);
  if (image) {
    const plaque3d = renderBrandLogoPlaque3DToDataUrl(image);
    if (plaque3d) return plaque3d;
  }

  const candidates = new Set<string>();
  candidates.add(getBrandLogoPublicUrl(origin));
  if (typeof window !== "undefined") {
    candidates.add(getBrandLogoPublicUrl(window.location.origin));
  }

  for (const logoUrl of candidates) {
    try {
      const response = await fetch(logoUrl);
      if (!response.ok) continue;
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      /* tenta próxima origem */
    }
  }

  return null;
}

export function buildEmailBrandFooterHtml(
  logoSrc: string,
  companyName = DEFAULT_COMPANY_TAGLINE
): string {
  const safeCompany = companyName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return [
    `<div style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:left">`,
    `<img src="${logoSrc}" alt="${safeCompany}" width="240" style="display:block;max-width:240px;height:auto;border-radius:12px" />`,
    `<p style="margin:12px 0 0;font-size:11px;color:#64748b;letter-spacing:0.06em;text-transform:uppercase">${safeCompany}</p>`,
    `</div>`,
  ].join("");
}
