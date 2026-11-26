import { listAudit, listProposals } from "@/lib/data/management";
import { Badge, Card, PageHeader, Td, Th } from "@/components/ui";
import { istDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function brief(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

export default async function ActivityPage() {
  const [audit, proposals] = await Promise.all([listAudit(200), listProposals()]);
  return (
    <div className="space-y-5">
      <PageHeader title="Activity log" description="Every change to campaigns, tasks, targets, settings and source data, with who made it, before/after values and the reason. AI proposals only change data after a person confirms them." />
      <Card title="AI proposals" subtitle="Pending proposals can be confirmed or rejected in the AI panel.">
        {proposals.length === 0 ? <div className="text-sm text-zinc-500">No proposals yet.</div> : (
          <table className="min-w-full">
            <thead><tr><Th>#</Th><Th>Created</Th><Th>Proposal</Th><Th>Status</Th><Th>Rationale</Th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {proposals.map((p) => (
                <tr key={p.id}>
                  <Td className="num">{p.id}</Td>
                  <Td className="text-xs">{istDateTime(p.created_at)}</Td>
                  <Td className="whitespace-normal">{p.summary}</Td>
                  <Td><Badge tone={p.status === "applied" ? "emerald" : p.status === "rejected" ? "zinc" : p.status === "failed" ? "rose" : "amber"}>{p.status}</Badge></Td>
                  <Td className="max-w-md whitespace-normal text-xs text-zinc-600">{p.rationale}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Change history">
        <div className="-mx-4 overflow-x-auto">
          <table className="min-w-full">
            <thead><tr><Th className="pl-4">When (IST)</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Before → after</Th><Th className="pr-4">Reason</Th></tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {audit.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td className="pl-4 text-xs">{istDateTime(a.at)}</Td>
                  <Td><Badge tone={a.actor.startsWith("ai") ? "violet" : a.actor === "system" ? "zinc" : "sky"}>{a.actor}</Badge></Td>
                  <Td className="text-xs font-medium">{a.action.replaceAll("_", " ")}</Td>
                  <Td className="text-xs">{a.entity}{a.entity_id ? ` · ${a.entity_id}` : ""}</Td>
                  <Td className="max-w-lg whitespace-normal font-mono text-[11px] text-zinc-600">
                    {a.before !== null && <div className="text-rose-700/80">− {brief(a.before)}</div>}
                    {a.after !== null && <div className="text-emerald-700/90">+ {brief(a.after)}</div>}
                  </Td>
                  <Td className="max-w-xs whitespace-normal pr-4 text-xs text-zinc-600">{a.reason}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
