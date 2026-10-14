import { NextResponse } from "next/server";
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { message } = body;

        if (!message) {
            return NextResponse.json({ error: "Message is required" }, { status: 400 });
        }

        const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT || "https://demo-cashflow-foundry.services.ai.azure.com/api/projects/demo-cashflow-foundryProject";
        const projectClient = new AIProjectClient(projectEndpoint, new DefaultAzureCredential());
        const openAIClient = projectClient.getOpenAIClient();

        // Ask the LLM to generate a short thinking phrase based on the user's message
        const response = await openAIClient.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4.1", // Or your default deployment
            messages: [
                {
                    role: "system",
                    content: "You are an AI assistant. The user will give you a query. Output a 3-5 word phrase describing what you are about to do to answer it, ending with an ellipsis (...). Start with a verb ending in -ing. E.g., 'Searching the knowledge base...', 'Analyzing your request...', 'Querying Fabric data...', 'Assessing user query...' Only output the phrase and nothing else."
                },
                {
                    role: "user",
                    content: message
                }
            ],
            max_completion_tokens: 15,
            temperature: 0.7,
        });

        const thinkingPhrase = response.choices[0]?.message?.content?.trim() || "Thinking...";

        return NextResponse.json({ phrase: thinkingPhrase });
    } catch (error) {
        console.error("Error generating thinking phrase:", error);
        // Fallback text if the LLM call fails
        return NextResponse.json({ phrase: "Thinking..." });
    }
}
