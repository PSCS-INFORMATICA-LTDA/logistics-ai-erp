import { identityFromTokenPayload } from "./callbackFlow";
import { pscsOneCallbackUri, pscsOneClientId, pscsOneTokenUrl, sanitizeEnvString } from "./config";
import { exchangeCoreToken, exchangeErrorReason } from "./oidcTransport";
import type {
  PscsOneCoreAuthSessionV1,
  PscsOneIdentityV1,
  PscsOneTokenExchangeV1,
} from "./types";

export class PscsOneIdentityService {
  static assertLogisticsProduct(identity: PscsOneIdentityV1): void {
    if (identity.product_key !== "logistics_ai") {
      throw new Error("product_key_denied");
    }
  }

  static async exchangeAuthorizationCode(code: string): Promise<PscsOneTokenExchangeV1> {
    const clientSecret = sanitizeEnvString(process.env.PSCS_ONE_CLIENT_SECRET);
    if (!clientSecret) {
      throw new Error("sso_client_unconfigured");
    }

    const { response, oidcToken } = await exchangeCoreToken({
      tokenUrl: pscsOneTokenUrl(),
      body: {
        grant_type: "authorization_code",
        code,
        redirect_uri: pscsOneCallbackUri(),
        client_id: pscsOneClientId(),
        client_secret: clientSecret,
      },
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      reason?: string;
      identity?: PscsOneTokenExchangeV1["identity"];
      core_auth?: PscsOneCoreAuthSessionV1;
    };

    if (!response.ok) {
      throw new Error(exchangeErrorReason(payload.reason, oidcToken));
    }

    const identity = identityFromTokenPayload(payload);
    const core_auth = normalizeCoreAuth(payload.core_auth);
    return core_auth ? { identity, core_auth } : { identity };
  }
}

function normalizeCoreAuth(raw: PscsOneCoreAuthSessionV1 | undefined): PscsOneCoreAuthSessionV1 | undefined {
  if (!raw?.access_token || !raw.refresh_token || !raw.expires_at) return undefined;
  return raw;
}
