import { NextResponse } from "next/server";
import { AIProjectClient } from "@azure/ai-projects";
import { auth } from "@/auth";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { createFoundryUserCredential } from "@/lib/foundry-user-credential";

// Downloads a Code Interpreter-generated file and returns it as a base64 data URL
async function downloadImageAsDataUrl(
    client: any,
    containerId: string | undefined,
    fileId: string
): Promise<string | null> {
    try {
        let res: any;
        if (containerId) {
            // Code Interpreter files live inside a container
            // NOTE: signature is retrieve(fileId, { container_id }) — NOT (containerId, fileId)
            res = await client.containers.files.content.retrieve(fileId, { container_id: containerId });
        } else {
            // Fallback: plain files endpoint
            res = await client.files.content(fileId);
        }
        const arrayBuffer = await res.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        return `data:image/png;base64,${base64}`;
    } catch (e) {
        console.error("Image download failed:", e);
        return null;
    }
}

export async function POST(req: NextRequest) {
    try {
        // 0. Check Auth
        const session = await auth();

        const cookieName = req.cookies.has("__Secure-authjs.session-token") ||
            req.cookies.has("__Secure-authjs.session-token.0")
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

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized. Please sign in." },
                { status: 401 }
            );
        }

        // 1. Receive the message from the frontend (e.g. "Hello")
        const body = await req.json();
        const { message, conversationId } = body;
        if (!message) {
            return NextResponse.json({ error: "Message is required" }, { status: 400 });
        }

        // 2. Set up the AI Foundry Project connection
        // We try to pull these from your .env.local if they exist, otherwise we use your fallback strings
        const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT || "https://demo-cashflow-foundry.services.ai.azure.com/api/projects/demo-cashflow-foundryProject";

        // Read "name:version" from env (e.g. "education-insights-agent:4")
        const agentRef = process.env.AZURE_OPENAI_AGENT_ID || "education-insights-agent:4";
        const [agentName, agentVersion = "4"] = agentRef.split(":");

        // Create the AI Project client
        const projectClient = new AIProjectClient(
            projectEndpoint,
            createFoundryUserCredential(jwt.refreshToken)
        );
        const openAIClient = projectClient.getOpenAIClient();

        // 3. THREAD MANAGEMENT
        let currentConversationId = conversationId;

        if (!currentConversationId) {
            // No Thread ID exists? Create a brand new Thread!
            const newConversation = await openAIClient.conversations.create({
                items: [{ type: "message", role: "user", content: [{ type: "input_text", text: message }] }]
            });
            currentConversationId = newConversation.id;
        } else {
            // Thread ID already exists? Add this message to it!
            await openAIClient.conversations.items.create(currentConversationId, {
                items: [{ type: "message", role: "user", content: [{ type: "input_text", text: message }] }]
            });
        }

        // Ask your custom agent to generate a response based on the conversation
        const response = await openAIClient.responses.create(
            {
                conversation: currentConversationId,
            },
            {
                body: { agent_reference: { name: agentName, version: agentVersion, type: "agent_reference" } },
            },
        );

        // 🔍 DEBUG: inspect the output shape so we can confirm where images live.
        // Remove this once inline images are confirmed working.
        console.log("RESPONSE OUTPUT:", JSON.stringify((response as any).output, null, 2));

        // Extract any charts/images produced by the Code Interpreter
        const images: string[] = [];
        try {
            const outputItems = (response as any).output ?? [];
            for (const item of outputItems) {
                if (item.type !== "message") continue;
                const contentParts = item.content ?? [];
                for (const part of contentParts) {
                    // Case A: a direct image content part
                    if (part.type === "output_image" || part.type === "image_file") {
                        const fileId = part.image_file?.file_id ?? part.file_id;
                        const containerId = part.container_id;
                        if (fileId) {
                            const url = await downloadImageAsDataUrl(openAIClient, containerId, fileId);
                            if (url) images.push(url);
                        }
                    }
                    // Case B: a file annotation on a text part (container file citation)
                    const annotations = part.annotations ?? [];
                    for (const ann of annotations) {
                        if (
                            ann.type === "container_file_citation" ||
                            ann.type === "file_path" ||
                            ann.type === "file_citation"
                        ) {
                            const fileId = ann.file_id;
                            const containerId = ann.container_id;
                            if (fileId) {
                                const url = await downloadImageAsDataUrl(openAIClient, containerId, fileId);
                                if (url) images.push(url);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Failed to extract images:", e);
        }

        // 4. Return the Agent's answer AND the Thread ID back to your frontend
        // Remove the broken "Download the chart" markdown links pointing to sandbox/mnt
        // (these caused the redirect-to-/dashboard issue — we render the image inline instead)
        const cleanedReply = (response.output_text || "")
            .replace(/\[[^\]]*\]\((sandbox:)?\/mnt\/data\/[^)]*\)/g, "")
            .replace(/\[Download[^\]]*\]\([^)]*\)/gi, "")
            .trim();

        // 4. Return the Agent's answer, images, AND the Thread ID back to your frontend
        return NextResponse.json({
            reply: cleanedReply,
            images,
            conversationId: currentConversationId
        });
    } catch (error: unknown) {
        console.error("Error communicating with Foundry Agent:", error);

        const err = error as Error & { code?: string; status?: number; message?: string };

        if (err.message?.includes("FOUNDRY_CONSENT_REQUIRED")) {
            return NextResponse.json(
                {
                    error: "Microsoft Foundry permission is required.",
                    code: "FOUNDRY_CONSENT_REQUIRED",
                },
                { status: 403 }
            );
        }

        let userMessage = "Sorry, I'm unable to respond right now. Please try again later.";

        if (err.code === "PermissionDenied" || err.status === 401) {
            userMessage = "I don't have permission to access the data service. Please contact your administrator.";
        } else if (err.code === "tool_user_error" || err.message?.includes("Create assistant failed")) {
            userMessage = "I was unable to retrieve data from Fabric. The data connection may be temporarily unavailable. Please try again shortly.";
        } else if (err.message?.includes("Failed to fetch") || err.message?.includes("ECONNREFUSED")) {
            userMessage = "Unable to reach the AI service. Please check your network connection and try again.";
        }

        return NextResponse.json({ error: userMessage }, { status: 500 });
    }
}