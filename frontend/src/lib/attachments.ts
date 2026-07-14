import { createClient } from "@/lib/supabase/client";

export type AttachmentEntityType =
  | "branch"
  | "partner"
  | "vehicle"
  | "driver"
  | "client"
  | "supplier"
  | "financial_transaction"
  | "cash_flow_entry"
  | "parking_entry"
  | "car_wash_service"
  | "service_order"
  | "vehicle_event"
  | "traffic_infraction";

export type Attachment = {
  id: string;
  company_id: string;
  entity_type: AttachmentEntityType;
  entity_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  description: string | null;
  uploaded_by: string | null;
  created_at: string;
};

const BUCKET = "company-attachments";

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

export function buildAttachmentPath(
  companyId: string,
  entityType: AttachmentEntityType,
  entityId: string,
  fileName: string
): string {
  const safeName = sanitizeFileName(fileName);
  return `${companyId}/${entityType}/${entityId}/${Date.now()}-${safeName}`;
}

export async function uploadEntityAttachment(params: {
  companyId: string;
  entityType: AttachmentEntityType;
  entityId: string;
  file: File;
  description?: string;
}): Promise<{ attachment: Attachment | null; error: string | null }> {
  const supabase = createClient();
  const storagePath = buildAttachmentPath(
    params.companyId,
    params.entityType,
    params.entityId,
    params.file.name
  );

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, params.file, {
      cacheControl: "3600",
      upsert: false,
      contentType: params.file.type || undefined,
    });

  if (uploadError) {
    return { attachment: null, error: uploadError.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("attachments")
    .insert({
      company_id: params.companyId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      file_name: params.file.name,
      storage_path: storagePath,
      mime_type: params.file.type || null,
      file_size: params.file.size,
      description: params.description ?? null,
      uploaded_by: user?.id ?? null,
    })
    .select("*")
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { attachment: null, error: error.message };
  }

  return { attachment: data as Attachment, error: null };
}

export async function listEntityAttachments(params: {
  companyId: string;
  entityType: AttachmentEntityType;
  entityId: string;
}): Promise<{ attachments: Attachment[]; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("company_id", params.companyId)
    .eq("entity_type", params.entityType)
    .eq("entity_id", params.entityId)
    .order("created_at", { ascending: false });

  if (error) return { attachments: [], error: error.message };
  return { attachments: (data as Attachment[]) ?? [], error: null };
}

export async function getAttachmentSignedUrl(
  storagePath: string,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function deleteEntityAttachment(attachment: Attachment): Promise<string | null> {
  const supabase = createClient();
  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .remove([attachment.storage_path]);

  if (storageError) return storageError.message;

  const { error } = await supabase.from("attachments").delete().eq("id", attachment.id);
  return error?.message ?? null;
}
