// Dev smoke test: two-step tool loop against Gemini (primary, then fallback model).
import { generateText, isStepCount, tool } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
async function run(modelId: string, thinking: boolean) {
  const t = Date.now();
  try {
    const r = await generateText({
      model: google(modelId),
      prompt: "What is the cost per confirmed registration for campaign C03? Use the tool.",
      tools: { get_cost: tool({ description: "Get cost per confirmed for a campaign", inputSchema: z.object({ id: z.string() }), execute: async ({ id }) => ({ id, cost_per_confirmed_inr: 220 }) }) },
      stopWhen: isStepCount(4),
      maxRetries: 0,
      ...(thinking ? { providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } } : {}),
    });
    console.log(modelId, "thinking:", thinking, "steps:", r.steps.length, "ms:", Date.now() - t, "text:", JSON.stringify(r.text.slice(0, 120)));
  } catch (e) {
    const err = e as { message?: string; statusCode?: number; responseBody?: string };
    console.log(modelId, "thinking:", thinking, "ERROR", err.statusCode, err.message?.slice(0, 300), err.responseBody?.slice(0, 300));
  }
}
// primary skipped
// primary skipped
await run(process.env.GEMINI_MODEL_FALLBACK!, true);
