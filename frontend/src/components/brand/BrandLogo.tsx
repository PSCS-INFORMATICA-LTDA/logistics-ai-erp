import type { CSSProperties } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { DEFAULT_COMPANY_LOGO_SRC } from "@/lib/company-logo";

type BrandLogoProps = {
  className?: string;
  imageClassName?: string;
  showTagline?: boolean;
  caption?: string;
  captionTone?: "on-dark" | "on-light";
  size?: "sm" | "md" | "lg" | "proposal";
  /** default: logo plano | plaque3d: placa branca (documentos) | mark: só a marca, fundo transparente (menu do sistema) */
  variant?: "default" | "plaque3d" | "mark";
  /** @deprecated Use variant="mark" no menu lateral. */
  plaqueSurface?: "sidebar" | "page";
  unoptimized?: boolean;
  /** @deprecated Mantido por compatibilidade. */
  performanceLite?: boolean;
  /** Logo da empresa (signed URL). Se omitido, usa fallback GRX. Só plaque3d/default. */
  companyLogoSrc?: string | null;
  companyLogoAlt?: string;
};

const sizes = {
  sm: { width: 160, height: 64 },
  md: { width: 220, height: 88 },
  lg: { width: 280, height: 112 },
  proposal: { width: 240, height: 96 },
};

/** Proporção do logo Logistics AI Platform (1222×458). */
const markSizes = {
  sm: { width: 196, height: 74 },
  md: { width: 240, height: 90 },
  lg: { width: 300, height: 112 },
  proposal: { width: 260, height: 98 },
};

/** Logo do sistema (Logistics AI Platform) — menu lateral / chrome do produto. */
const SYSTEM_LOGO_MARK_SRC = "/pscs-logo-mark.png?v=7";

const MARK_DEPTH_LAYERS = [4, 3, 2, 1] as const;

function LogoImage({
  dim,
  className,
  depth,
  priority = false,
  alt = "",
  ariaHidden = true,
  unoptimized = false,
  src,
}: {
  dim: { width: number; height: number };
  className?: string;
  depth?: number;
  priority?: boolean;
  alt?: string;
  ariaHidden?: boolean;
  unoptimized?: boolean;
  src: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      aria-hidden={ariaHidden}
      width={dim.width}
      height={dim.height}
      priority={priority}
      unoptimized={unoptimized}
      style={
        depth !== undefined ? ({ ["--depth"]: depth } as CSSProperties) : undefined
      }
      className={className}
    />
  );
}

export function BrandLogo({
  className,
  imageClassName,
  showTagline = false,
  caption,
  captionTone = "on-dark",
  size = "md",
  variant = "default",
  plaqueSurface = "page",
  unoptimized = false,
  companyLogoSrc = null,
  companyLogoAlt = "Logo da empresa",
}: BrandLogoProps) {
  const dim = sizes[size];
  const companySrc = companyLogoSrc?.trim() || DEFAULT_COMPANY_LOGO_SRC;

  if (variant === "mark") {
    const markDim = markSizes[size];
    return (
      <div className={cn("brand-logo-mark", className)}>
        <div className="brand-logo-mark-3d-stage">
          <div className="brand-logo-mark-stack">
            {MARK_DEPTH_LAYERS.map((depth) => (
              <LogoImage
                key={depth}
                dim={markDim}
                depth={depth}
                src={SYSTEM_LOGO_MARK_SRC}
                unoptimized
                className="brand-logo-mark-depth"
              />
            ))}
            <LogoImage
              dim={markDim}
              src={SYSTEM_LOGO_MARK_SRC}
              priority
              unoptimized
              alt="Logistics AI Platform"
              ariaHidden={false}
              className={cn("brand-logo-mark-image", imageClassName)}
            />
          </div>
        </div>
        {caption ? (
          <p
            className={cn(
              "brand-logo-caption",
              captionTone === "on-light" && "brand-logo-caption--light"
            )}
          >
            {caption}
          </p>
        ) : null}
      </div>
    );
  }

  const image = (
    <Image
      src={companySrc}
      alt={companyLogoAlt}
      width={dim.width}
      height={dim.height}
      priority
      unoptimized={unoptimized || Boolean(companyLogoSrc)}
      className={cn("h-auto w-auto max-w-full object-contain", imageClassName)}
    />
  );

  if (variant === "plaque3d") {
    const isSidebar = plaqueSurface === "sidebar";

    return (
      <div className={cn("brand-logo-brand", className)}>
        <div
          className={cn(
            "brand-logo-plaque",
            isSidebar ? "brand-logo-plaque--sidebar" : "brand-logo-plaque--page"
          )}
        >
          <div
            className={cn(
              "brand-logo-3d-stage",
              isSidebar && "brand-logo-3d-stage--sidebar"
            )}
          >
            <LogoImage
              dim={dim}
              src={companySrc}
              priority
              unoptimized={unoptimized || Boolean(companyLogoSrc)}
              alt={companyLogoAlt}
              ariaHidden={false}
              className={cn("brand-logo-image brand-logo-image--front", imageClassName)}
            />
          </div>
        </div>
        {caption ? (
          <p
            className={cn(
              "brand-logo-caption",
              captionTone === "on-light" && "brand-logo-caption--light"
            )}
          >
            {caption}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      {image}
      {showTagline && (
        <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-slate-500">
          Gestão financeira e operacional
        </p>
      )}
    </div>
  );
}
