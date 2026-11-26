// Chatbot eval runner: drives /api/chat exactly like the browser (full history per turn),
// rebuilds assistant messages from the UI message stream and checks each answer.
// Usage: npx tsx --env-file=.env.local scripts/eval.mts [baseUrl] [caseId,caseId…]
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { CASES } from "../evals/cases";

const BASE = process.argv[2] && process.argv[2].startsWith("http") ? process.argv[2] : "http://localhost:3100";
const only = (process.argv.find((a) => !a.startsWith("http") && a.includes(",") || /^[a-z-]+$/.test(a) && CASES.some((c) => c.id === a)) ?? "").split(",").filter(Boolean);
const PAUSE_MS = Number(process.env.EVAL_PAUSE_MS ?? 3000);

type Part = { type: string; text?: string; state?: string };

async function ask(history: UIMessage[], asOf: string): Promise<{ message: UIMessage; ms: number; error?: string }> {
  const t = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-eval-token": process.env.EVAL_TOKEN ?? "" },
    body: JSON.stringify({ messages: history, asOf, page: "/ (eval)" }),
  });
  if (!res.ok || !res.body) return { message: { id: "x", role: "assistant", parts: [] }, ms: Date.now() - t, error: `${res.status} ${await res.text()}` };
  // SSE → chunk objects
  const decoder = new TextDecoder();
  let buf = "";
  const chunks = new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              controller.enqueue(JSON.parse(data));
            } catch {}
          }
        }
      }
      controller.close();
    },
  });
  let last: UIMessage | undefined;
  let error: string | undefined;
  for await (const m of readUIMessageStream({ stream: chunks, onError: (e) => (error = String(e)) })) last = m as UIMessage;
  return { message: last ?? { id: "x", role: "assistant", parts: [] }, ms: Date.now() - t, error };
}

const textOf = (m: UIMessage) => (m.parts as Part[]).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
const toolsOf = (m: UIMessage) => (m.parts as Part[]).filter((p) => p.type.startsWith("tool-")).map((p) => p.type.slice(5));

let pass = 0, fail = 0, totalMs = 0, turns = 0;
const failures: string[] = [];
for (const c of CASES.filter((x) => !only.length || only.includes(x.id))) {
  const history: UIMessage[] = [];
  console.log(`\n━━ ${c.id} [${c.category}] as of ${c.asOf}`);
  for (const [i, turn] of c.turns.entries()) {
    history.push({ id: `${c.id}-u${i}`, role: "user", parts: [{ type: "text", text: turn.q }] });
    const { message, ms, error } = await ask(history, c.asOf);
    history.push({ ...message, id: message.id || `${c.id}-a${i}` });
    totalMs += ms;
    turns++;
    const text = textOf(message);
    const tools = toolsOf(message);
    const problems: string[] = [];
    if (error) problems.push(`error: ${error.slice(0, 200)}`);
    for (const r of turn.expect ?? []) if (!r.test(text)) problems.push(`missing ${r}`);
    for (const r of turn.notExpect ?? []) if (r.test(text)) problems.push(`unexpected ${r}`);
    if (turn.tools && !turn.tools.some((t) => tools.includes(t))) problems.push(`expected one of tools [${turn.tools}] got [${tools}]`);
    const ok = problems.length === 0;
    ok ? pass++ : fail++;
    if (!ok) failures.push(`${c.id}#${i + 1}: ${problems.join("; ")}`);
    console.log(`  Q${i + 1}: ${turn.q}`);
    console.log(`  ${ok ? "PASS" : "FAIL"} · ${(ms / 1000).toFixed(1)}s · tools [${tools.join(", ")}] · ${(message.metadata as { model?: string } | undefined)?.model ?? "?"}`);
    console.log(`  A: ${text.replace(/\s+/g, " ").slice(0, 420)}${text.length > 420 ? "…" : ""}`);
    if (!ok) console.log(`  ✗ ${problems.join(" | ")}`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}
console.log(`\n══ ${pass}/${pass + fail} turns passed · avg ${(totalMs / Math.max(turns, 1) / 1000).toFixed(1)}s per turn`);
if (failures.length) console.log(failures.map((f) => ` - ${f}`).join("\n"));
process.exit(fail ? 1 : 0);
