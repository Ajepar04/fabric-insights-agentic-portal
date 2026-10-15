
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { randomBytes, createHash } from "node:crypto";
import { getToken } from "next-auth/jwt";

export async function GET(req: NextRequest) {
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json(
            { error: "Please sign in first." },
            { status: 401 }
        );
    }

    const cookieName = req.cookies.has("__Secure-authjs.session-token")
        ? "__Secure-authjs.session-token"
        : "authjs.session-token";

    const jwt = await getToken({
        req,
        secret: process.env.AUTH_SECRET,
        cookieName,
        salt: cookieName,
    });

    if (!jwt?.sub) {
        return NextResponse.json(
            { error: "Please sign in again." },
            { status: 401 }
        );
    }

    const userBinding = createHash("sha256")
        .update(jwt.sub)
        .digest("hex");


    const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
    const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

    if (!tenantId || !clientId) {
        return NextResponse.json(
            { error: "Missing Microsoft Entra configuration." },
            { status: 500 }
        );
    }


    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

    const redirectUri = new URL(
        "/api/auth/foundry/callback",
        req.url
    ).toString();

    const authorizationUrl = new URL(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`
    );

    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set(
        "scope",
        "openid profile email offline_access https://ai.azure.com/user_impersonation"
    );
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("prompt", "consent");

    const response = NextResponse.redirect(authorizationUrl);

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        path: "/api/auth/foundry",
        maxAge: 600,
    };

    response.cookies.set("foundry_oauth_state", state, cookieOptions);
    response.cookies.set("foundry_oauth_nonce", nonce, cookieOptions);
    response.cookies.set(
        "foundry_oauth_user",
        userBinding,
        cookieOptions
    );
    response.cookies.set(
        "foundry_oauth_verifier",
        codeVerifier,
        cookieOptions
    );

    return response;
}
