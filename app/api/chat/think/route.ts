
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AIProjectClient } from "@azure/ai-projects";
import { auth } from "@/auth";
import { getToken } from "next-auth/jwt";
import { createFoundryUserCredential } from "@/lib/foundry-user-credential";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    // 1. Verify that the user is signed in
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json(
            { error: "Unauthorized. Please sign in." },
            { status: 401 }
        );
    }

    // 2. Retrieve the signed-in user's encrypted session JWT
    const cookieName = req.cookies.has(
        "__Secure-authjs.session-token"
    )
        ? "__Secure-authjs.session-token"
        : "authjs.session-token";

    const jwt = await getToken({
        req,
        secret: process.env.AUTH_SECRET,
        cookieName,
        salt: cookieName,
    });

    if (
        !jwt?.sub ||
        typeof jwt.refreshToken !== "string" ||
        jwt.error
    ) {
        return NextResponse.json(
            { error: "Please sign in again." },
            { status: 401 }
        );
    }

    try {
        // 3. Validate the user's message
        const body = await req.json();
        const { message } = body;

        if (typeof message !== "string" || !message.trim()) {
            return NextResponse.json(
                { error: "Message is required" },
                { status: 400 }
            );
        }

        // 4. Connect to Foundry using the user's delegated identity
        const projectEndpoint =
            process.env.FOUNDRY_PROJECT_ENDPOINT ||
            "https://demo-cashflow-foundry.services.ai.azure.com/api/projects/demo-cashflow-foundryProject";

        const projectClient = new AIProjectClient(
            projectEndpoint,
            createFoundryUserCredential(jwt.refreshToken)
        );

        const openAIClient = projectClient.getOpenAIClient();

        // 5. Generate a short thinking phrase
        const response = await openAIClient.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4.1",
            messages: [
                {
                    role: "system",
                    content:
                        "You are an AI assistant. The user will give you a query. " +
                        "Output a 3-5 word phrase describing what you are about to do " +
                        "to answer it, ending with an ellipsis (...). " +
                        "Start with a verb ending in -ing. " +
                        "Only output the phrase and nothing else."
                },
                {
                    role: "user",
                    content: message
                }
            ],
            max_completion_tokens: 15,
            temperature: 0.7,
        });

        const thinkingPhrase =
            response.choices[0]?.message?.content?.trim() ||
            "Thinking...";

        return NextResponse.json({ phrase: thinkingPhrase });

    } catch (error) {
        // Don't expose sensitive authentication details
        console.error("Error generating thinking phrase:", error);

        return NextResponse.json({
            phrase: "Thinking..."
        });
    }
}

