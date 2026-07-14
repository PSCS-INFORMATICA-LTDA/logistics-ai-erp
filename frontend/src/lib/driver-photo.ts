import { createClient } from "@/lib/supabase/client";
import { buildAttachmentPath, getAttachmentSignedUrl } from "@/lib/attachments";

const BUCKET = "company-attachments";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export function validateDriverPhotoFile(file: File): string | null {
  if (!ALLOWED.has(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
    return "Use uma imagem JPG, PNG ou WEBP.";
  }
  if (file.size > MAX_BYTES) {
    return "A foto deve ter no máximo 5 MB.";
  }
  return null;
}

export async function uploadDriverPhoto(params: {
  companyId: string;
  driverId: string;
  file: File;
  previousPath?: string | null;
}): Promise<{ path: string | null; error: string | null }> {
  const validation = validateDriverPhotoFile(params.file);
  if (validation) return { path: null, error: validation };

  const supabase = createClient();
  const storagePath = buildAttachmentPath(
    params.companyId,
    "driver",
    params.driverId,
    `foto-voucher-${params.file.name}`
  );

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, params.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: params.file.type || "image/jpeg",
  });

  if (uploadError) {
    return { path: null, error: uploadError.message };
  }

  const { error: updateError } = await supabase
    .from("drivers")
    .update({ photo_storage_path: storagePath })
    .eq("id", params.driverId);

  if (updateError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { path: null, error: updateError.message };
  }

  if (params.previousPath && params.previousPath !== storagePath) {
    await supabase.storage.from(BUCKET).remove([params.previousPath]);
  }

  return { path: storagePath, error: null };
}

export async function removeDriverPhoto(params: {
  driverId: string;
  storagePath: string;
}): Promise<string | null> {
  const supabase = createClient();
  const { error: updateError } = await supabase
    .from("drivers")
    .update({ photo_storage_path: null })
    .eq("id", params.driverId);
  if (updateError) return updateError.message;

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([params.storagePath]);
  return storageError?.message ?? null;
}

export async function getDriverPhotoUrl(
  storagePath: string | null | undefined
): Promise<string | null> {
  if (!storagePath) return null;
  return getAttachmentSignedUrl(storagePath, 60 * 60 * 6);
}
