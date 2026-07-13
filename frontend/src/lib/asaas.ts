/** Cliente Asaas (sandbox ou produção). Cartão nunca é persistido no GRX. */

export type AsaasEnv = "sandbox" | "production";

export function getAsaasConfig(): {
  configured: boolean;
  env: AsaasEnv;
  baseUrl: string;
  apiKey: string | null;
} {
  const apiKey = process.env.ASAAS_API_KEY?.trim() || null;
  const env = (process.env.ASAAS_ENV?.trim().toLowerCase() === "production"
    ? "production"
    : "sandbox") as AsaasEnv;
  const baseUrl =
    env === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";

  return {
    configured: Boolean(apiKey && !apiKey.startsWith("your-")),
    env,
    baseUrl,
    apiKey,
  };
}

export class AsaasApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "AsaasApiError";
    this.status = status;
    this.details = details;
  }
}

export async function asaasRequest<T>(
  path: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown }
): Promise<T> {
  const { configured, baseUrl, apiKey } = getAsaasConfig();
  if (!configured || !apiKey) {
    throw new AsaasApiError(
      "Asaas não configurado. Defina ASAAS_API_KEY (e opcionalmente ASAAS_ENV) no servidor.",
      503,
      null
    );
  }

  const { body, ...rest } = init ?? {};
  const headers: HeadersInit = {
    access_token: apiKey,
    "Content-Type": "application/json",
    ...(rest.headers ?? {}),
  };

  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (payload as { errors?: { description?: string }[] } | null)?.errors?.[0]?.description ||
      (payload as { message?: string } | null)?.message ||
      `Erro Asaas (${response.status}).`;
    throw new AsaasApiError(message, response.status, payload);
  }

  return payload as T;
}

export type AsaasCustomer = {
  id: string;
  name?: string;
  email?: string;
  cpfCnpj?: string;
};

export type AsaasSubscription = {
  id: string;
  status?: string;
  nextDueDate?: string;
  value?: number;
  billingType?: string;
  creditCard?: {
    creditCardNumber?: string;
    creditCardBrand?: string;
  };
};

export async function asaasCreateOrUpdateCustomer(input: {
  existingId?: string | null;
  name: string;
  email: string;
  cpfCnpj: string;
  phone?: string | null;
  postalCode?: string | null;
  addressNumber?: string | null;
}): Promise<AsaasCustomer> {
  const body = {
    name: input.name,
    email: input.email,
    cpfCnpj: input.cpfCnpj.replace(/\D/g, ""),
    mobilePhone: input.phone?.replace(/\D/g, "") || undefined,
    postalCode: input.postalCode?.replace(/\D/g, "") || undefined,
    addressNumber: input.addressNumber || undefined,
    notificationDisabled: true,
  };

  if (input.existingId) {
    return asaasRequest<AsaasCustomer>(`/customers/${input.existingId}`, {
      method: "PUT",
      body,
    });
  }

  return asaasRequest<AsaasCustomer>("/customers", {
    method: "POST",
    body,
  });
}

export async function asaasCreateSubscription(input: {
  customerId: string;
  value: number;
  nextDueDate: string;
  description: string;
  creditCard: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    phone?: string;
  };
  remoteIp: string;
}): Promise<AsaasSubscription> {
  return asaasRequest<AsaasSubscription>("/subscriptions", {
    method: "POST",
    body: {
      customer: input.customerId,
      billingType: "CREDIT_CARD",
      value: Number(input.value.toFixed(2)),
      nextDueDate: input.nextDueDate,
      cycle: "MONTHLY",
      description: input.description,
      creditCard: {
        holderName: input.creditCard.holderName,
        number: input.creditCard.number.replace(/\D/g, ""),
        expiryMonth: input.creditCard.expiryMonth.padStart(2, "0"),
        expiryYear: input.creditCard.expiryYear.length === 2
          ? `20${input.creditCard.expiryYear}`
          : input.creditCard.expiryYear,
        ccv: input.creditCard.ccv,
      },
      creditCardHolderInfo: {
        name: input.creditCardHolderInfo.name,
        email: input.creditCardHolderInfo.email,
        cpfCnpj: input.creditCardHolderInfo.cpfCnpj.replace(/\D/g, ""),
        postalCode: input.creditCardHolderInfo.postalCode.replace(/\D/g, ""),
        addressNumber: input.creditCardHolderInfo.addressNumber,
        phone: input.creditCardHolderInfo.phone?.replace(/\D/g, "") || undefined,
      },
      remoteIp: input.remoteIp,
    },
  });
}

export async function asaasUpdateSubscriptionValue(
  subscriptionId: string,
  value: number
): Promise<AsaasSubscription> {
  return asaasRequest<AsaasSubscription>(`/subscriptions/${subscriptionId}`, {
    method: "PUT",
    body: { value: Number(value.toFixed(2)), updatePendingPayments: true },
  });
}

export async function asaasCancelSubscription(subscriptionId: string): Promise<AsaasSubscription> {
  return asaasRequest<AsaasSubscription>(`/subscriptions/${subscriptionId}`, {
    method: "DELETE",
  });
}

export function mapAsaasSubscriptionStatus(status?: string): string {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "INACTIVE":
      return "canceled";
    case "EXPIRED":
      return "canceled";
    case "OVERDUE":
      return "overdue";
    default:
      return status ? "pending" : "inactive";
  }
}
