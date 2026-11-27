// Checks the configured OpenRouter model handles a two-step tool call through the AI SDK.
// Usage: npm run check:models [-- <model-id>]
import { generateText, isStepCount, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

const openrouter = createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY, includeUsage: true, headers: { "X-Title": "CampusFest Growth Center" } });
const modelId = process.argv[2] || process.env.OPENROUTER_MODEL!;
const t = Date.now();
try {
  const r = await generateText({
    model: openrouter(modelId),
    system: "Answer using tools only. Never guess numbers.",
    prompt: "What is the cost per confirmed registration for campaign C03, and is it above the portfolio's ₹115? Use the tools.",
    tools: {
      get_cost: tool({ description: "Cost per confirmed registration for a campaign", inputSchema: z.object({ id: z.string() }), execute: async ({ id }) => ({ id, cost_per_confirmed_inr: 220, portfolio_inr: 115 }) }),
      calculate: tool({ description: "Evaluate arithmetic", inputSchema: z.object({ expression: z.string() }), execute: async ({ expression }) => ({ expression, result: Function(`return (${expression.replace(/[^0-9+\-*/(). ]/g, "")})`)() }) }),
    },
    stopWhen: isStepCount(5),
    maxRetries: 0,
  });
  console.log(modelId, "steps:", r.steps.length, "tools:", r.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)).join(","), "ms:", Date.now() - t);
  console.log("usage:", JSON.stringify(r.totalUsage));
  console.log("text:", r.text.slice(0, 400));
} catch (e) {
  const err = e as { message?: string; statusCode?: number; responseBody?: string };
  console.log("ERROR", err.statusCode, err.message?.slice(0, 300), err.responseBody?.slice(0, 400));
}
