
const FOUNDRY_SCOPE = "https://ai.azure.com/.default";

type ScopedToken = {
    token: string;
    expiresOnTimestamp: number;
};

// Initial local implementation.
// Token rotation must be persisted securely for production.
export function createFoundryUserCredential(
    initialRefreshToken: string
) {
    let currentRefreshToken = initialRefreshToken;
    let cachedToken: ScopedToken | null = null;

    return {
        async getToken(
            scopes: string | string[]
        ): Promise<ScopedToken> {
            const requestedScopes = Array.isArray(scopes)
                ? scopes
                : [scopes];

            if (
                requestedScopes.length !== 1 ||
                requestedScopes[0] !== FOUNDRY_SCOPE
            ) {
                throw new Error("Unexpected Foundry token scope");
            }

            if (
                cachedToken &&
                cachedToken.expiresOnTimestamp > Date.now() + 60_000
            ) {
                return cachedToken;
            }

            const tenantId =
                process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
            const clientId =
                process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
            const clientSecret =
                process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

            if (!tenantId || !clientId || !clientSecret) {
                throw new Error(
                    "Missing Entra ID server configuration"
                );
            }

            const response = await fetch(
                `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                        client_id: clientId,
                        client_secret: clientSecret,
                        grant_type: "refresh_token",
                        refresh_token: currentRefreshToken,
                        scope: FOUNDRY_SCOPE,
                    }),
                    cache: "no-store",
                }
            );


            if (!response.ok) {
                const errorBody = await response.json().catch(() => null);

                // Log only diagnostic fields, never tokens or secrets.
                console.error("Foundry token request failed:", {
                    httpStatus: response.status,
                    error: errorBody?.error,
                    errorCodes: errorBody?.error_codes,
                    suberror: errorBody?.suberror,
                });

                throw new Error(
                    `User-delegated Foundry authentication failed (HTTP ${response.status})`
                );
            }


            const data = (await response.json()) as {
                access_token?: unknown;
                expires_in?: unknown;
                refresh_token?: unknown;
            };

            if (
                typeof data.access_token !== "string" ||
                typeof data.expires_in !== "number"
            ) {
                throw new Error("Invalid Foundry token response");
            }

            // Rotation within the current request only.
            if (typeof data.refresh_token === "string") {
                currentRefreshToken = data.refresh_token;
            }

            cachedToken = {
                token: data.access_token,
                expiresOnTimestamp:
                    Date.now() + data.expires_in * 1000,
            };

            return cachedToken;
        },
    };
}
