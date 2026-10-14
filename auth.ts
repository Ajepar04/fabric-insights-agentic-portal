import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers: [
        MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
            issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER!,
            authorization: {
                params: {
                    scope: "openid profile email offline_access https://analysis.windows.net/powerbi/api/Report.Read.All",
                },
            },
        }),
    ],
    // Session lives for up to 5 hours, destroyed on sign-out
    session: {
        maxAge: 5 * 60 * 60, // 5 hours in seconds
    },
    jwt: {
        maxAge: 5 * 60 * 60, // match session maxAge
    },
    pages: {
        signIn: "/",
    },
    callbacks: {
        authorized({ auth, request }) {
            const isProtected = request.nextUrl.pathname.startsWith("/dashboard");
            if (isProtected && !auth) return false;
            return true;
        },
        async jwt({ token, account, profile }) {
            if (profile) {
                token.name = profile.name as string;
                token.email = (profile.email || profile.preferred_username || profile.upn) as string;
            }
            // On first sign-in, persist tokens and expiry
            if (account) {
                token.accessToken = account.access_token;
                token.refreshToken = account.refresh_token;
                // expires_at is in seconds (epoch), fall back to 1 hour from now
                token.expiresAt = account.expires_at ?? Math.floor(Date.now() / 1000) + 3600;
                return token;
            }

            // If token hasn't expired yet, return as-is (refresh 60s before expiry)
            if (typeof token.expiresAt === "number" && Date.now() / 1000 < token.expiresAt - 60) {
                return token;
            }

            // Token expired or about to expire — refresh it
            if (token.refreshToken) {
                try {
                    const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID!;
                    const response = await fetch(
                        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/x-www-form-urlencoded" },
                            body: new URLSearchParams({
                                client_id: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
                                client_secret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
                                grant_type: "refresh_token",
                                refresh_token: token.refreshToken as string,
                                scope: "openid profile email offline_access https://analysis.windows.net/powerbi/api/Report.Read.All",
                            }),
                        }
                    );

                    const refreshed = await response.json();

                    if (!response.ok) {
                        console.error("Token refresh failed:", refreshed);
                        // Return existing token — user may need to re-login
                        return { ...token, error: "RefreshTokenError" };
                    }

                    token.accessToken = refreshed.access_token;
                    token.expiresAt = Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 3600);
                    // Entra ID may rotate the refresh token
                    if (refreshed.refresh_token) {
                        token.refreshToken = refreshed.refresh_token;
                    }
                } catch (error) {
                    console.error("Token refresh error:", error);
                    return { ...token, error: "RefreshTokenError" };
                }
            }

            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.name = token.name as string;
                session.user.email = token.email as string;
            }
            session.accessToken = token.accessToken as string;
            session.expiresAt = token.expiresAt as number;
            return session;
        },
    },
});