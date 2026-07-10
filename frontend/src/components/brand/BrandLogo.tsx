import type { CSSProperties } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

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
};

const sizes = {
  sm: { width: 160, height: 64 },
  md: { width: 220, height: 88 },
  lg: { width: 280, height: 112 },
  proposal: { width: 240, height: 96 },
};

/** Proporção real do grx-logo-mark.png (570×491). */
const markSizes = {
  sm: { width: 168, height: 145 },
  md: { width: 220, height: 190 },
  lg: { width: 280, height: 241 },
  proposal: { width: 240, height: 207 },
};

/** Logo com placa branca (voucher, proposta, login). */
const BRAND_LOGO_SRC = "/grx-logo.png?v=3";
/** Marca GRX + tagline, fundo transparente (menu cinza do sistema). */
const BRAND_LOGO_MARK_SRC = "/grx-logo-mark.png?v=4";

const MARK_DEPTH_LAYERS = [3, 2, 1] as const;

function LogoImage({
  dim,
  className,
  depth,
  priority = false,
  alt = "",
  ariaHidden = true,
  unoptimized = false,
  src = BRAND_LOGO_SRC,
}: {
  dim: { width: number; height: number };
  className?: string;
  depth?: number;
  priority?: boolean;
  alt?: string;
  ariaHidden?: boolean;
  unoptimized?: boolean;
  src?: string;
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
}: BrandLogoProps) {
  const dim = sizes[size];

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
                src={BRAND_LOGO_MARK_SRC}
                unoptimized
                className="brand-logo-mark-depth"
              />
            ))}
            <LogoImage
              dim={markDim}
              src={BRAND_LOGO_MARK_SRC}
              priority
              unoptimized
              alt="GRX Transportes e Logística"
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
      src={BRAND_LOGO_SRC}
      alt="GRX Transportes e Logística"
      width={dim.width}
      height={dim.height}
      priority
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
              priority
              unoptimized={unoptimized}
              alt="GRX Transportes e Logística"
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
