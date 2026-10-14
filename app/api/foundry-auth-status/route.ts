
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getToken } from "next-auth/jwt";

export const runtime = "nodejs";

export async function GET(req: Request) {
    // Require a signed-in user.
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json(
            { status: "unauthorized" },
            { status: 401 }
        );
    }

    // Retrieve the encrypted NextAuth JWT server-side.
    const cookieName = req.headers
        .get("cookie")
        ?.includes("__Secure-authjs.session-token=")
        ? "__Secure-authjs.session-token"
        : "authjs.session-token";

    const jwt = await getToken({
        req: req as any,
        secret: process.env.AUTH_SECRET,
        cookieName,
        salt: cookieName,
    });

    if (!jwt?.refreshToken || jwt.error) {
        return NextResponse.json(
            {
                status: "no_valid_refresh_token",
                jwtFound: Boolean(jwt),
                refreshTokenPresent: Boolean(jwt?.refreshToken),
                tokenErrorPresent: Boolean(jwt?.error),
                tokenErrorType: jwt?.error ?? null,
            },
            { status: 401 }
        );
    }

    const tenantId =
        process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID!;

    try {
        const response = await fetch(
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id:
                        process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
                    client_secret:
                        process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
                    grant_type: "refresh_token",
                    refresh_token: jwt.refreshToken as string,
                    scope: "https://ai.azure.com/.default",
                }),
                cache: "no-store",
            }
        );

        const result = await response.json();

        if (!response.ok) {
            return NextResponse.json({
                status: "token_request_failed",
                error: result.error ?? "unknown",
                errorCodes: result.error_codes ?? [],
            });
        }

        return NextResponse.json({
            status: "token_acquired",
            expiresIn: result.expires_in,
        });
    } catch {
        return NextResponse.json(
            { status: "request_failed" },
            { status: 500 }
        );
    }
}
