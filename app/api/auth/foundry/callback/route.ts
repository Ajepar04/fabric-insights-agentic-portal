
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { timingSafeEqual } from "node:crypto";
import { getToken } from "next-auth/jwt";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";


function clearFoundryOAuthCookies(response: NextResponse) {
    const cookieNames = [
        "foundry_oauth_state",
        "foundry_oauth_verifier",
        "foundry_oauth_user",
        "foundry_oauth_nonce",
    ];

    for (const name of cookieNames) {
        response.cookies.set(name, "", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/api/auth/foundry",
            maxAge: 0,
        });
    }

    return response;
}

async function handleFoundryCallback(req: NextRequest) {
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json(
            { error: "Please sign in again." },
            { status: 401 }
        );
    }

    const receivedState = req.nextUrl.searchParams.get("state");
    const expectedState = req.cookies.get("foundry_oauth_state")?.value;
    const codeVerifier = req.cookies.get("foundry_oauth_verifier")?.value;

    if (!receivedState || !expectedState || !codeVerifier) {
        return NextResponse.json(
            { error: "Missing Foundry authorization state." },
            { status: 400 }
        );
    }

    const received = Buffer.from(receivedState);
    const expected = Buffer.from(expectedState);

    if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
    ) {
        return NextResponse.json(
            { error: "Invalid Foundry authorization state." },
            { status: 400 }
        );
    }


    const expectedUser = req.cookies.get("foundry_oauth_user")?.value;

    const cookieName = req.cookies.has("__Secure-authjs.session-token")
        ? "__Secure-authjs.session-token"
        : "authjs.session-token";

    const jwt = await getToken({
        req,
        secret: process.env.AUTH_SECRET,
        cookieName,
        salt: cookieName,
    });

    if (!jwt?.sub || !expectedUser) {
        return NextResponse.json(
            { error: "Foundry authorization user verification failed." },
            { status: 401 }
        );
    }

    const actualUser = createHash("sha256")
        .update(jwt.sub)
        .digest("hex");

    const actualBuffer = Buffer.from(actualUser);
    const expectedBuffer = Buffer.from(expectedUser);

    if (
        actualBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
        return NextResponse.json(
            { error: "Foundry authorization belongs to a different user." },
            { status: 403 }
        );
    }


    const microsoftError = req.nextUrl.searchParams.get("error");

    if (microsoftError) {
        const errorDescription =
            req.nextUrl.searchParams.get("error_description") ?? "";

        // Keep detailed diagnostics on the server.
        // Do not return raw Microsoft error descriptions to the browser.
        console.warn("Foundry authorization was not completed:", {
            error: microsoftError,
            adminApprovalRequired:
                errorDescription.includes("AADSTS90094") ||
                errorDescription.includes("AADSTS65001"),
        });

        return NextResponse.json(
            {
                error:
                    microsoftError === "access_denied"
                        ? "Microsoft Foundry permission was not granted. Your organization may require administrator approval."
                        : "Microsoft Foundry authorization could not be completed.",
                code: "FOUNDRY_AUTHORIZATION_FAILED",
            },
            { status: 403 }
        );
    }

    const authorizationCode = req.nextUrl.searchParams.get("code");

    if (!authorizationCode) {
        return NextResponse.json(
            { error: "Microsoft did not return an authorization code." },
            { status: 400 }
        );
    }

    const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
    const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
    const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
        return NextResponse.json(
            { error: "Missing Microsoft Entra configuration." },
            { status: 500 }
        );
    }

    const redirectUri = new URL(
        "/api/auth/foundry/callback",
        req.url
    ).toString();

    const tokenResponse = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: "authorization_code",
                code: authorizationCode,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
                scope: "openid profile email offline_access https://ai.azure.com/user_impersonation",
            }),
            cache: "no-store",
        }
    );

    if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.json().catch(() => null);

        console.error("Foundry consent token exchange failed:", {
            httpStatus: tokenResponse.status,
            error: errorBody?.error,
            errorCodes: errorBody?.error_codes,
        });

        return NextResponse.json(
            { error: "Unable to complete Microsoft Foundry authorization." },
            { status: 400 }
        );
    }

    const tokenData = await tokenResponse.json();

    if (
        typeof tokenData.access_token !== "string" ||
        typeof tokenData.token_type !== "string" ||
        tokenData.token_type.toLowerCase() !== "bearer"
    ) {
        return NextResponse.json(
            { error: "Invalid Microsoft Foundry token response." },
            { status: 400 }
        );
    }


    const expectedNonce = req.cookies.get("foundry_oauth_nonce")?.value;

    if (!expectedNonce || typeof tokenData.id_token !== "string") {
        return NextResponse.json(
            { error: "Missing Microsoft identity verification data." },
            { status: 400 }
        );
    }

    const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;

    const signingKeys = createRemoteJWKSet(
        new URL(
            `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
        )
    );

    let verifiedIdentity;

    try {
        const { payload } = await jwtVerify(
            tokenData.id_token,
            signingKeys,
            {
                issuer,
                audience: clientId,
            }
        );

        if (
            payload.nonce !== expectedNonce ||
            typeof payload.oid !== "string" ||
            payload.tid !== tenantId
        ) {
            throw new Error("Microsoft identity claims did not match.");
        }

        verifiedIdentity = payload;
    } catch {
        return NextResponse.json(
            { error: "Microsoft identity verification failed." },
            { status: 401 }
        );
    }

    // Confirm that the returned Microsoft account matches the
    // account currently signed in through NextAuth.

    const expectedMicrosoftOid = jwt.microsoftOid;
    const expectedMicrosoftTid = jwt.microsoftTid;

    const matchesOidAndTid =
        typeof expectedMicrosoftOid === "string" &&
        typeof expectedMicrosoftTid === "string" &&
        verifiedIdentity.oid === expectedMicrosoftOid &&
        verifiedIdentity.tid === expectedMicrosoftTid;

    const matchesSub =
        typeof jwt.sub === "string" &&
        verifiedIdentity.sub === jwt.sub;

    if (!matchesOidAndTid && !matchesSub) {
        console.error("Foundry account mismatch diagnostics:", {
            sessionSub: jwt.sub,
            verifiedSub: verifiedIdentity.sub,
            sessionOid: expectedMicrosoftOid,
            verifiedOid: verifiedIdentity.oid,
            sessionTid: expectedMicrosoftTid,
            verifiedTid: verifiedIdentity.tid,
        });

        return NextResponse.json(
            { error: "Microsoft account does not match the signed-in user." },
            { status: 403 }
        );
    }

    // Never return access tokens or refresh tokens to the browser.

    const response = NextResponse.redirect(
        new URL("/dashboard?foundry=connected", req.url)
    );

    return clearFoundryOAuthCookies(response);
}

export async function GET(req: NextRequest) {
    try {
        const response = await handleFoundryCallback(req);

        // Clear temporary OAuth cookies on success or failure.
        return clearFoundryOAuthCookies(response);
    } catch (error) {
        console.error(
            "Unexpected Foundry callback error:",
            error instanceof Error ? error.name : "Unknown error"
        );

        const response = NextResponse.json(
            {
                error: "Microsoft Foundry authorization could not be completed.",
            },
            { status: 500 }
        );

        return clearFoundryOAuthCookies(response);
    }
}

