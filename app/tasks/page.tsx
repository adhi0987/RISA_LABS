import Link from "next/link";
import clsx from "clsx";
import { getDataset, clampAsOf } from "@/lib/data/dataset";
import { listBets, listTasks } from "@/lib/data/management";
import { addDays } from "@/engine/time";
import { Card, PageHeader } from "@/components/ui";
import { TaskList } from "@/components/tasks/task-list";
import { NewTaskForm } from "@/components/tasks/new-task-form";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const sp = await searchParams;
  const { dataset } = await getDataset();
  const asOf = clampAsOf(typeof sp.asOf === "string" ? sp.asOf : null, dataset);
  const owner = typeof sp.owner === "string" ? sp.owner : "";
  const campaign = typeof sp.campaign === "string" ? sp.campaign : "";
  const bet = typeof sp.bet === "string" ? sp.bet : "";
  const [all, bets] = await Promise.all([listTasks(), listBets()]);
  const tasks = all.filter((t) => (!owner || t.owner_id === owner) && (!campaign || t.campaign_id === campaign) && (!bet || t.bet_id === bet));
  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due_date && t.due_date < asOf);
  const campaigns = dataset.campaigns.map((c) => ({ campaign_id: c.campaign_id, campaign_name: c.campaign_name }));
  const betList = bets.map((b) => ({ bet_id: b.bet_id, name: b.name }));

  const href = (k: string, v: string) => {
    const p = new URLSearchParams({ asOf, ...(owner && { owner }), ...(campaign && { campaign }), ...(bet && { bet }) });
    if (v) p.set(k, v);
    else p.delete(k);
    return `/tasks?${p.toString()}`;
  };
  const chip = (active: boolean) => clsx("rounded-full border px-2.5 py-0.5 text-xs", active ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks"
        description={<>Owners, deadlines and status for every initiative. “Overdue” is measured against the selected as-of date (the campaign clock), so you can replay what was late on any day.</>}
      >
        <div className="flex gap-4 text-sm">
          <div><span className="num text-lg font-semibold">{open.length}</span> <span className="text-zinc-500">open</span></div>
          <div><span className={clsx("num text-lg font-semibold", overdue.length > 0 && "text-rose-600")}>{overdue.length}</span> <span className="text-zinc-500">overdue</span></div>
          <div><span className="num text-lg font-semibold">{tasks.filter((t) => t.source === "ai").length}</span> <span className="text-zinc-500">from AI</span></div>
        </div>
      </PageHeader>

      <Card title="Add a task">
        <NewTaskForm owners={dataset.owners} campaigns={campaigns} bets={betList} defaultDue={addDays(asOf, 7)} />
      </Card>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-xs text-zinc-500">Owner</span>
          <Link href={href("owner", "")} className={chip(!owner)}>All</Link>
          {dataset.owners.map((o) => <Link key={o.owner_id} href={href("owner", o.owner_id)} className={chip(owner === o.owner_id)}>{o.owner_name}</Link>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-xs text-zinc-500">Campaign</span>
          <Link href={href("campaign", "")} className={chip(!campaign)}>All</Link>
          {campaigns.map((c) => <Link key={c.campaign_id} href={href("campaign", c.campaign_id)} className={chip(campaign === c.campaign_id)}>{c.campaign_name}</Link>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-xs text-zinc-500">Bet</span>
          <Link href={href("bet", "")} className={chip(!bet)}>All</Link>
          {betList.map((b) => <Link key={b.bet_id} href={href("bet", b.bet_id)} className={chip(bet === b.bet_id)}>{b.name}</Link>)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={`Open (${open.length})`}>
          <TaskList tasks={open} owners={dataset.owners} asOf={asOf} campaigns={campaigns} bets={betList} />
        </Card>
        <Card title={`Done (${tasks.length - open.length})`}>
          <TaskList tasks={tasks.filter((t) => t.status === "done")} owners={dataset.owners} asOf={asOf} campaigns={campaigns} bets={betList} />
        </Card>
      </div>
    </div>
  );
}
