import { NextResponse } from "next/server";
import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

export async function GET() {
    const projectEndpoint =
        process.env.FOUNDRY_PROJECT_ENDPOINT ||
        "https://demo-cashflow-foundry.services.ai.azure.com/api/projects/demo-cashflow-foundryProject";

    try {
        // 1. Test credential acquisition
        const credential = new DefaultAzureCredential();

        // 2. Test project client creation
        const projectClient = new AIProjectClient(projectEndpoint, credential);

        // 3. Test OpenAI client (this triggers the actual auth handshake)
        const openAIClient = projectClient.getOpenAIClient();

        // 4. Lightweight call — list models to verify data plane access
        const models = await openAIClient.models.list();
        const modelList = [];
        for await (const model of models) {
            modelList.push(model.id);
            if (modelList.length >= 3) break; // Just grab a few to confirm it works
        }

        return NextResponse.json({
            status: "connected",
            endpoint: projectEndpoint,
            identity: "DefaultAzureCredential (Managed Identity)",
            modelsFound: modelList.length,
            sampleModels: modelList,
            timestamp: new Date().toISOString(),
        });
    } catch (error: unknown) {
        const err = error as Error & { code?: string; statusCode?: number };
        return NextResponse.json(
            {
                status: "error",
                endpoint: projectEndpoint,
                error: err.message,
                code: err.code || null,
                statusCode: err.statusCode || null,
                timestamp: new Date().toISOString(),
            },
            { status: 500 }
        );
    }
}
