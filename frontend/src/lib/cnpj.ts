import { fetchAddressByCep, formatCep, normalizeCep } from "@/lib/cep";
import { formatCnpj, isValidCnpj, onlyDigits } from "@/lib/br-documents";

export type CnpjCompanyInfo = {
  cnpj: string;
  legalName: string;
  tradeName: string;
  status: string;
  isActive: boolean;
  postalCode: string;
  street: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
  /** Endereço completo formatado para gravação/exibição. */
  address: string;
  phone: string;
  /** IE não vem da Receita Federal aberta; campo fica para preenchimento manual. */
  stateRegistration: string;
  checkedAt: string;
  /** true quando logradouro veio do CEP (lacuna na base CNPJ). */
  streetFromCep?: boolean;
  /** true quando número/rua vieram de fonte complementar (OpenCNPJ). */
  addressEnriched?: boolean;
};

type AddressDraft = {
  street: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  legalName: string;
  tradeName: string;
  status: string;
};

function formatPhoneDigits(raw?: string | null): string {
  const digits = onlyDigits(raw ?? "");
  if (digits.length < 10) return "";
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  if (rest.length === 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return digits;
}

function normalizeStreetNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^(s\/?n|sn)$/i.test(trimmed)) return "";
  return trimmed;
}

function joinStreet(type: string, street: string): string {
  const t = type.trim();
  const s = street.trim();
  if (!s) return "";
  if (!t) return s;
  if (s.toLowerCase().startsWith(t.toLowerCase())) return s;
  return `${t} ${s}`.trim();
}

function buildFullAddress(parts: {
  street: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
}): string {
  const line1 = [parts.street, parts.addressNumber, parts.addressComplement]
    .filter(Boolean)
    .join(", ");
  const line2 = [parts.neighborhood, parts.city, parts.state].filter(Boolean).join(" - ");
  const cep = parts.postalCode ? `CEP ${parts.postalCode}` : "";
  return [line1, line2, cep].filter(Boolean).join(" · ");
}

/** Situação cadastral da RFB: ATIVA (código 2) e equivalentes. */
export function isCnpjSituationActive(status: string): boolean {
  const normalized = status
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  return normalized === "ATIVA" || normalized.includes("ATIVA");
}

async function fetchBrasilApiCnpj(cnpj: string): Promise<Partial<AddressDraft> | null> {
  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Não foi possível consultar o CNPJ no momento. Tente novamente.");

  const data = (await response.json()) as {
    razao_social?: string;
    nome_fantasia?: string;
    descricao_situacao_cadastral?: string;
    situacao_cadastral?: string | number;
    cep?: string;
    logradouro?: string;
    descricao_tipo_de_logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    municipio?: string;
    uf?: string;
    ddd_telefone_1?: string;
  };

  return {
    legalName: (data.razao_social ?? "").trim(),
    tradeName: (data.nome_fantasia ?? "").trim(),
    status: (data.descricao_situacao_cadastral ?? String(data.situacao_cadastral ?? "")).trim(),
    postalCode: data.cep ? formatCep(normalizeCep(String(data.cep))) : "",
    street: joinStreet(data.descricao_tipo_de_logradouro ?? "", data.logradouro ?? ""),
    addressNumber: normalizeStreetNumber(data.numero ?? ""),
    addressComplement: (data.complemento ?? "").trim(),
    neighborhood: (data.bairro ?? "").trim(),
    city: (data.municipio ?? "").trim(),
    state: (data.uf ?? "").trim().toUpperCase(),
    phone: formatPhoneDigits(data.ddd_telefone_1),
  };
}

/** OpenCNPJ costuma trazer número/logradouro quando a BrasilAPI omite (comum em MEI). */
async function fetchOpenCnpj(cnpj: string): Promise<Partial<AddressDraft> | null> {
  try {
    const response = await fetch(`https://api.opencnpj.org/${cnpj}`, { cache: "no-store" });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      razao_social?: string;
      nome_fantasia?: string;
      situacao_cadastral?: string;
      cep?: string;
      tipo_logradouro?: string;
      logradouro?: string;
      numero?: string;
      complemento?: string;
      bairro?: string;
      municipio?: string;
      uf?: string;
      telefones?: Array<{ ddd?: string; numero?: string }>;
    };

    const phoneRaw = data.telefones?.[0]
      ? `${data.telefones[0].ddd ?? ""}${data.telefones[0].numero ?? ""}`
      : "";

    return {
      legalName: (data.razao_social ?? "").trim(),
      tradeName: (data.nome_fantasia ?? "").trim(),
      status: (data.situacao_cadastral ?? "").trim().toUpperCase(),
      postalCode: data.cep ? formatCep(normalizeCep(String(data.cep))) : "",
      street: joinStreet(data.tipo_logradouro ?? "", data.logradouro ?? ""),
      addressNumber: normalizeStreetNumber(data.numero ?? ""),
      addressComplement: (data.complemento ?? "").trim(),
      neighborhood: (data.bairro ?? "").trim(),
      city: (data.municipio ?? "").trim(),
      state: (data.uf ?? "").trim().toUpperCase(),
      phone: formatPhoneDigits(phoneRaw),
    };
  } catch {
    return null;
  }
}

function mergeDraft(base: Partial<AddressDraft>, enrich: Partial<AddressDraft>): AddressDraft {
  return {
    legalName: base.legalName || enrich.legalName || "",
    tradeName: base.tradeName || enrich.tradeName || "",
    status: base.status || enrich.status || "",
    postalCode: base.postalCode || enrich.postalCode || "",
    street: base.street || enrich.street || "",
    addressNumber: base.addressNumber || enrich.addressNumber || "",
    addressComplement: base.addressComplement || enrich.addressComplement || "",
    neighborhood: base.neighborhood || enrich.neighborhood || "",
    city: base.city || enrich.city || "",
    state: base.state || enrich.state || "",
    phone: base.phone || enrich.phone || "",
  };
}

export async function fetchCompanyByCnpj(cnpjInput: string): Promise<CnpjCompanyInfo> {
  const cnpj = onlyDigits(cnpjInput);
  if (cnpj.length !== 14) {
    throw new Error("Informe um CNPJ válido com 14 dígitos.");
  }
  if (!isValidCnpj(cnpj)) {
    throw new Error("CNPJ inválido. Verifique os dígitos informados.");
  }

  const brasil = await fetchBrasilApiCnpj(cnpj);
  if (!brasil) {
    throw new Error("CNPJ não encontrado na Receita Federal.");
  }

  let draft = mergeDraft(brasil, {});
  let addressEnriched = false;
  let streetFromCep = false;

  // Complementa número/rua quando a BrasilAPI vem incompleta (frequente em MEI).
  if (!draft.street || !draft.addressNumber || !draft.phone) {
    const open = await fetchOpenCnpj(cnpj);
    if (open) {
      const beforeStreet = draft.street;
      const beforeNumber = draft.addressNumber;
      draft = mergeDraft(draft, open);
      if (
        (!beforeStreet && draft.street) ||
        (!beforeNumber && draft.addressNumber)
      ) {
        addressEnriched = true;
      }
    }
  }

  if (draft.postalCode && !draft.street) {
    try {
      const cepAddr = await fetchAddressByCep(draft.postalCode);
      if (cepAddr.street) {
        draft.street = cepAddr.street;
        streetFromCep = true;
      }
      if (!draft.neighborhood && cepAddr.neighborhood) draft.neighborhood = cepAddr.neighborhood;
      if (!draft.city && cepAddr.city) draft.city = cepAddr.city;
      if (!draft.state && cepAddr.state) draft.state = cepAddr.state.trim().toUpperCase();
    } catch {
      // usuário completa manualmente
    }
  }

  if (!draft.legalName) {
    throw new Error("CNPJ encontrado, mas sem razão social. Preencha os dados manualmente.");
  }

  const addressParts = {
    street: draft.street,
    addressNumber: draft.addressNumber,
    addressComplement: draft.addressComplement,
    neighborhood: draft.neighborhood,
    city: draft.city,
    state: draft.state,
    postalCode: draft.postalCode,
  };

  return {
    cnpj: formatCnpj(cnpj),
    legalName: draft.legalName,
    tradeName: draft.tradeName,
    status: draft.status || "—",
    isActive: isCnpjSituationActive(draft.status || "ATIVA"),
    postalCode: draft.postalCode,
    street: draft.street,
    addressNumber: draft.addressNumber,
    addressComplement: draft.addressComplement,
    neighborhood: draft.neighborhood,
    city: draft.city,
    state: draft.state,
    address: buildFullAddress(addressParts),
    phone: draft.phone,
    stateRegistration: "",
    checkedAt: new Date().toISOString(),
    streetFromCep,
    addressEnriched,
  };
}

/** Mapeia o resultado da consulta para campos de formulário (cliente/fornecedor/empresa). */
export function cnpjInfoToFormPatch(
  info: CnpjCompanyInfo,
  options?: { fillName?: boolean; fillPhone?: boolean; mapStatusToCadastro?: boolean }
): Record<string, unknown> {
  const fillName = options?.fillName !== false;
  const fillPhone = options?.fillPhone !== false;
  const mapStatus = options?.mapStatusToCadastro !== false;

  const patch: Record<string, unknown> = {
    document: info.cnpj,
    trade_name: info.tradeName || "",
    postal_code: info.postalCode,
    street: info.street,
    address_number: info.addressNumber,
    address_complement: info.addressComplement,
    neighborhood: info.neighborhood,
    city: info.city,
    state: info.state,
    address: info.address,
    cnpj_status: info.status,
    cnpj_checked_at: info.checkedAt,
  };

  if (fillName) {
    patch.name = info.legalName;
  }
  if (fillPhone && info.phone) {
    patch.phone = info.phone;
  }
  if (mapStatus) {
    patch.status = info.isActive ? "Ativo" : "Inativo";
  }

  return patch;
}
