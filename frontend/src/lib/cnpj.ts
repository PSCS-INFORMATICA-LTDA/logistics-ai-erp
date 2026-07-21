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
  /** true quando logradouro veio do CEP (Receita às vezes não traz rua/número). */
  streetFromCep?: boolean;
};

function formatPhoneFromBrasilApi(dddTelefone?: string | null): string {
  const digits = onlyDigits(dddTelefone ?? "");
  if (digits.length < 10) return "";
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length === 9) {
    return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  }
  if (rest.length === 8) {
    return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  return digits;
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

export async function fetchCompanyByCnpj(cnpjInput: string): Promise<CnpjCompanyInfo> {
  const cnpj = onlyDigits(cnpjInput);
  if (cnpj.length !== 14) {
    throw new Error("Informe um CNPJ válido com 14 dígitos.");
  }
  if (!isValidCnpj(cnpj)) {
    throw new Error("CNPJ inválido. Verifique os dígitos informados.");
  }

  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    cache: "no-store",
  });

  if (response.status === 404) {
    throw new Error("CNPJ não encontrado na Receita Federal.");
  }
  if (!response.ok) {
    throw new Error("Não foi possível consultar o CNPJ no momento. Tente novamente.");
  }

  const data = (await response.json()) as {
    cnpj?: string;
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

  let street = (data.logradouro ?? "").trim();
  // Receita às vezes manda tipo + logradouro separados
  const streetType = (data.descricao_tipo_de_logradouro ?? "").trim();
  if (street && streetType && !street.toLowerCase().startsWith(streetType.toLowerCase())) {
    street = `${streetType} ${street}`.trim();
  }

  let addressNumber = (data.numero ?? "").trim();
  if (/^(s\/?n|sn)$/i.test(addressNumber)) addressNumber = "";

  const addressComplement = (data.complemento ?? "").trim();
  let neighborhood = (data.bairro ?? "").trim();
  let city = (data.municipio ?? "").trim();
  let state = (data.uf ?? "").trim().toUpperCase();
  const postalCode = data.cep ? formatCep(normalizeCep(String(data.cep))) : "";
  const status = (data.descricao_situacao_cadastral ?? String(data.situacao_cadastral ?? "")).trim();
  const legalName = (data.razao_social ?? "").trim();
  const tradeName = (data.nome_fantasia ?? "").trim();

  if (!legalName) {
    throw new Error("CNPJ encontrado, mas sem razão social. Preencha os dados manualmente.");
  }

  // Muitos MEI/CNPJ novos vêm só com CEP + bairro/cidade, sem logradouro na Receita.
  // Completa a rua (e lacunas) via consulta de CEP.
  let streetFromCep = false;
  if (postalCode && !street) {
    try {
      const cepAddr = await fetchAddressByCep(postalCode);
      if (cepAddr.street) {
        street = cepAddr.street;
        streetFromCep = true;
      }
      if (!neighborhood && cepAddr.neighborhood) neighborhood = cepAddr.neighborhood;
      if (!city && cepAddr.city) city = cepAddr.city;
      if (!state && cepAddr.state) state = cepAddr.state.trim().toUpperCase();
    } catch {
      // Mantém o que veio do CNPJ; usuário completa manualmente.
    }
  }

  const addressParts = {
    street,
    addressNumber,
    addressComplement,
    neighborhood,
    city,
    state,
    postalCode,
  };

  return {
    cnpj: formatCnpj(cnpj),
    legalName,
    tradeName,
    status: status || "—",
    isActive: isCnpjSituationActive(status || "ATIVA"),
    postalCode,
    street,
    addressNumber,
    addressComplement,
    neighborhood,
    city,
    state,
    address: buildFullAddress(addressParts),
    phone: formatPhoneFromBrasilApi(data.ddd_telefone_1),
    stateRegistration: "",
    checkedAt: new Date().toISOString(),
    streetFromCep,
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
