"use server";
// Server actions for every UI mutation. Each one writes through lib/data/mutations (audit + version bump)
// and calls refresh() so the current page re-renders with fresh analytics in the same round trip.
import { refresh } from "next/cache";
import fs from "node:fs/promises";
import path from "node:path";
import {
  addDaily, addTargetVersion, appendRegistrationStatus, createTask, deleteTask, deleteUserTarget, reallocateBudget,
  saveEngineSettings, updateCampaign, updateDaily, updateTask, type CampaignPatch, type TaskInput,
} from "@/lib/data/mutations";
import { applyProposedAction, rejectProposedAction } from "@/lib/ai/apply";
import { parseWorkbook } from "@/lib/ingest/parse";
import { loadDatasetIntoDb } from "@/lib/ingest/load-db";
import { getSql } from "@/lib/db/client";

export type ActionResult = { ok: true; message?: string } | { ok: false, error: string };

async function run(fn: () => Promise<unknown>, message?: string): Promise<ActionResult> {
  try {
    await fn();
    refresh();
    return { ok: true, message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateCampaignAction(campaignId: string, patch: CampaignPatch) {
  return run(() => updateCampaign(campaignId, patch, "user"), "Campaign saved");
}
export async function reallocateBudgetAction(fromId: string, toId: string, amount: number) {
  return run(() => reallocateBudget(fromId, toId, amount, "user"), "Budget moved");
}
export async function createTaskAction(input: TaskInput) {
  return run(() => createTask(input, "user"), "Task created");
}
export async function updateTaskAction(id: number, patch: Partial<TaskInput>) {
  return run(() => updateTask(id, patch as never, "user"), "Task updated");
}
export async function deleteTaskAction(id: number) {
  return run(() => deleteTask(id, "user"), "Task deleted");
}
export async function updateDailyAction(activityId: string, patch: Record<string, number>) {
  return run(() => updateDaily(activityId, patch, "user"), "Row saved");
}
export async function addDailyAction(input: { campaign_id: string; activity_date: string; marketing_spend_inr?: number; impressions?: number; clicks?: number }) {
  return run(() => addDaily(input, "user"), "Row added");
}
export async function appendStatusAction(registrationId: string, status: "interested" | "confirmed" | "cancelled" | "waitlisted", effectiveAtIso: string) {
  return run(() => appendRegistrationStatus(registrationId, status, effectiveAtIso, "user"), "Status version added");
}
export async function addTargetAction(input: Parameters<typeof addTargetVersion>[0]) {
  return run(() => addTargetVersion(input, "user"), "Target version added");
}
export async function deleteTargetAction(id: number) {
  return run(() => deleteUserTarget(id, "user"), "Target version deleted");
}
export async function saveSettingsAction(value: unknown) {
  return run(() => saveEngineSettings(value, "user"), "Settings saved");
}
export async function confirmProposalAction(id: number) {
  return run(() => applyProposedAction(id), "Applied");
}
export async function rejectProposalAction(id: number) {
  return run(() => rejectProposedAction(id), "Rejected");
}

export async function resetDatasetAction(confirmText: string) {
  if (confirmText !== "RESET") return { ok: false, error: 'Type RESET to confirm.' } as ActionResult;
  return run(async () => {
    const file = path.join(process.cwd(), "data/original/Attendee Dataset.xlsx");
    const ds = parseWorkbook(await fs.readFile(file), "Attendee Dataset.xlsx");
    await loadDatasetIntoDb(getSql(), ds, { actor: "user", reason: "Reset to the original 2025 dataset" });
  }, "Original dataset restored");
}

export async function importDatasetAction(form: FormData): Promise<ActionResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an .xlsx file." };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "File is larger than 8 MB." };
  return run(async () => {
    const ds = parseWorkbook(new Uint8Array(await file.arrayBuffer()), file.name);
    if (ds.campaigns.length === 0 || ds.people.length === 0) throw new Error("Workbook has no campaigns or people.");
    await loadDatasetIntoDb(getSql(), ds, { actor: "user", reason: `Imported ${file.name}` });
  }, "Dataset imported");
}
