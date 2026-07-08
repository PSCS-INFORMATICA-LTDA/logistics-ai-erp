export type Company = {
  id: string;
  name: string;
  trade_name: string | null;
  document: string | null;
  status: string;
};

export type Partner = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  partner_type: string;
  status: string;
  use_in_allocation: boolean;
  notes: string | null;
};

export type Vehicle = {
  id: string;
  company_id: string;
  code: string;
  plate: string;
  plate_display: string | null;
  model: string | null;
  year: number | null;
  vehicle_category: string;
  axle_count: number | null;
  operational_partner_id: string | null;
  status: string;
  notes: string | null;
};

export type VehicleOwnership = {
  id: string;
  company_id: string;
  vehicle_id: string;
  partner_id: string;
  ownership_percentage: number;
  effective_date: string;
  end_date: string | null;
  status: string;
};

export type DreAccount = {
  id: string;
  company_id: string;
  name: string;
  classification: string;
  transaction_type: string;
  status: string;
};

export type Driver = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  name_normalized: string;
  driver_type: string;
  status: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  document: string | null;
  cnh_number: string | null;
  cnh_expiry_date: string | null;
  cnh_categories: string[];
  active_for_operations: boolean;
  notes: string | null;
};

export type ServiceOrder = {
  id: string;
  company_id: string;
  branch_id: string | null;
  code: string;
  service_type: string;
  service_date: string;
  plate: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: string | null;
  client_name: string | null;
  phone: string | null;
  service_name: string;
  service_categories: string[];
  chart_of_account_id: string | null;
  service_amount: number | null;
  status: string;
  entry_date: string | null;
  entry_time: string | null;
  exit_date: string | null;
  exit_time: string | null;
  attendant: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  payment_method: string | null;
  notes: string | null;
  freight_origin_address: string | null;
  freight_destination_address: string | null;
  freight_distance_km: number | null;
  freight_toll_amount: number | null;
  freight_toll_count: number | null;
  freight_toll_detail: Array<{
    order: number;
    name: string;
    city?: string;
    state?: string;
    concessionaire?: string;
    amount: number;
    tagAmount?: number;
  }> | null;
  freight_antt_cargo_type: number | null;
  freight_antt_axles: number | null;
  freight_antt_composicao_veicular: boolean;
  freight_antt_alto_desempenho: boolean;
  freight_antt_retorno_vazio: boolean;
  freight_antt_minimum: number | null;
  freight_antt_detail: Record<string, unknown> | null;
  freight_suggested_total: number | null;
  freight_agreed_amount: number | null;
  freight_travel_days: number | null;
  freight_per_diem_detail: Array<{
    day: number;
    lodging: number;
    breakfast: number;
    meals: number;
    dinner: number;
    daily_allowance: number;
  }> | null;
  freight_per_diem_total: number | null;
  freight_per_diem_charge_to: string;
  freight_transport_km_rate: number | null;
  proposal_token: string | null;
  proposal_sent_at: string | null;
  proposal_last_follow_up_at: string | null;
  proposal_follow_up_count: number;
  proposal_response: ProposalResponse;
  proposal_accepted_at: string | null;
  proposal_rejected_at: string | null;
  proposed_driver_id: string | null;
  driver_assignment_token: string | null;
  driver_assignment_sent_at: string | null;
  driver_assignment_response: DriverAssignmentResponse;
  driver_assignment_accepted_at: string | null;
  driver_assignment_rejected_at: string | null;
};

export type DriverAssignmentResponse = "pending" | "accepted" | "rejected";

export type TrafficInfraction = {
  id: string;
  company_id: string;
  code: string;
  plate: string;
  vehicle_id: string;
  driver_id: string | null;
  service_order_id: string | null;
  infraction_date: string;
  ait_number: string | null;
  description: string | null;
  amount: number | null;
  points: number | null;
  assignment_source: string | null;
  assignment_status: string;
  authority_status: string;
  authority_indicated_at: string | null;
  authority_responded_at: string | null;
  payment_proof_status: string;
  payment_proof_received_at: string | null;
  payment_validated_at: string | null;
  case_status: string;
  notes: string | null;
};

export const SERVICE_ORDER_TYPES = ["Frete", "Transporte", "Estacionamento", "CarWash", "Outro"] as const;

export const SERVICE_ORDER_TYPE_LABELS: Record<string, string> = {
  Frete: "Frete",
  Transporte: "Transporte",
  Estacionamento: "Estacionamento",
  CarWash: "Lava-rápido",
  Outro: "Outro",
};

export const SERVICE_ORDER_STATUS = [
  "Aberto",
  "Aguardando aprovação cliente",
  "Concluido",
  "Cancelado",
] as const;

export const PROPOSAL_RESPONSE = ["pending", "accepted", "rejected"] as const;
export type ProposalResponse = (typeof PROPOSAL_RESPONSE)[number];

export const PROPOSAL_RESPONSE_LABELS: Record<ProposalResponse, string> = {
  pending: "Aguardando cliente",
  accepted: "Aceita pelo cliente",
  rejected: "Recusada pelo cliente",
};
export const INFRACTION_ASSIGNMENT_STATUS = ["Pendente", "Confirmado", "Contestado"] as const;
export const INFRACTION_AUTHORITY_STATUS = ["Pendente", "Indicado", "Aceito", "Recusado"] as const;
export const INFRACTION_PAYMENT_PROOF_STATUS = ["Pendente", "Apresentado", "Validado"] as const;
export const INFRACTION_CASE_STATUS = ["EmAndamento", "Baixada", "Arquivada"] as const;

export type Client = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  document: string | null;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
  status: string;
  notes: string | null;
};

export type Supplier = {
  id: string;
  company_id: string;
  code: string;
  name: string;
  category: string;
  document: string | null;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
  status: string;
  notes: string | null;
};

export type CompanyMember = {
  id: string;
  company_id: string;
  user_id: string;
  role: string;
};

export const OWNERSHIP_STATUS_OPTIONS = ["Ativo", "Inativo", "Encerrado"] as const;

export const STATUS_OPTIONS = ["Ativo", "Inativo", "Pendente", "Encerrado"] as const;

export const PARTNER_TYPES = ["Socio", "Parceira", "Empresa"] as const;

export const VEHICLE_CATEGORIES = ["Van", "Onibus", "Caminhao", "MicroOnibus", "Outro"] as const;

export const DRIVER_TYPES = ["Motorista", "Empregado", "Agregado", "Terceiro", "Prestador"] as const;

export const SUPPLIER_CATEGORIES = [
  "Combustivel",
  "Manutencao",
  "Seguro",
  "Documentacao",
  "Pneus",
  "RH",
  "Financas",
  "Outros",
] as const;

export const DRE_CLASSIFICATIONS = [
  "Receitas",
  "Operacional",
  "Administrativo",
  "RH",
  "Financas",
  "Ocupacao",
  "TI",
  "Marketing",
  "Lavagens",
  "Taxas e Tributos",
  "Movimentacoes",
] as const;

export const TRANSACTION_TYPES = ["Receita", "Despesa", "Outros"] as const;
