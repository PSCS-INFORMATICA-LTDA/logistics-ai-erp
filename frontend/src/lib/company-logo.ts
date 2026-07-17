import { createClient } from "@/lib/supabase/client";
import { getAttachmentSignedUrl } from "@/lib/attachments";

const BUCKET = "company-attachments";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

export function validateCompanyLogoFile(file: File): string | null {
  if (!ALLOWED.has(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
    return "Use uma imagem JPG, PNG ou WEBP.";
  }
  if (file.size > MAX_BYTES) {
    return "O logo deve ter no máximo 5 MB.";
  }
  return null;
}

function buildCompanyLogoPath(companyId: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName);
  return `${companyId}/company/${companyId}/${Date.now()}-logo-${safeName}`;
}

export async function uploadCompanyLogo(params: {
  companyId: string;
  file: File;
  previousPath?: string | null;
}): Promise<{ path: string | null; error: string | null }> {
  const validation = validateCompanyLogoFile(params.file);
  if (validation) return { path: null, error: validation };

  const supabase = createClient();
  const storagePath = buildCompanyLogoPath(params.companyId, params.file.name);

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, params.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: params.file.type || "image/png",
  });

  if (uploadError) {
    return { path: null, error: uploadError.message };
  }

  const { error: updateError } = await supabase
    .from("companies")
    .update({ logo_storage_path: storagePath })
    .eq("id", params.companyId);

  if (updateError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { path: null, error: updateError.message };
  }

  if (params.previousPath && params.previousPath !== storagePath) {
    await supabase.storage.from(BUCKET).remove([params.previousPath]);
  }

  return { path: storagePath, error: null };
}

export async function removeCompanyLogo(params: {
  companyId: string;
  storagePath: string;
}): Promise<string | null> {
  const supabase = createClient();
  const { error: updateError } = await supabase
    .from("companies")
    .update({ logo_storage_path: null })
    .eq("id", params.companyId);
  if (updateError) return updateError.message;

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([params.storagePath]);
  return storageError?.message ?? null;
}

export async function getCompanyLogoUrl(
  storagePath: string | null | undefined
): Promise<string | null> {
  if (!storagePath) return null;
  return getAttachmentSignedUrl(storagePath, 60 * 60 * 6);
}

/** Fallback estático quando a empresa ainda não enviou logo. */
export const DEFAULT_COMPANY_LOGO_SRC = "/grx-logo.png?v=3";

export function companyDisplayName(company: {
  name?: string | null;
  trade_name?: string | null;
} | null | undefined): string {
  const trade = company?.trade_name?.trim();
  const name = company?.name?.trim();
  return trade || name || "Empresa";
}
