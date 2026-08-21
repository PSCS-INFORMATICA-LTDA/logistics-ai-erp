import { identityFromTokenPayload } from "./callbackFlow";
import { pscsOneCallbackUri, pscsOneClientId, pscsOneTokenUrl } from "./config";
import type { PscsOneIdentityV1 } from "./types";

export class PscsOneIdentityService {
  static assertLogisticsProduct(identity: PscsOneIdentityV1): void {
    if (identity.product_key !== "logistics_ai") {
      throw new Error("product_key_denied");
    }
  }

  static async exchangeAuthorizationCode(code: string): Promise<PscsOneIdentityV1> {
    const clientSecret = process.env.PSCS_ONE_CLIENT_SECRET?.trim();
    if (!clientSecret) {
      throw new Error("sso_client_unconfigured");
    }

    const response = await fetch(pscsOneTokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: pscsOneCallbackUri(),
        client_id: pscsOneClientId(),
        client_secret: clientSecret,
      }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      reason?: string;
      identity?: PscsOneIdentityV1;
    };

    if (!response.ok) {
      throw new Error(payload.reason || "token_exchange_denied");
    }

    return identityFromTokenPayload(payload);
  }
}
