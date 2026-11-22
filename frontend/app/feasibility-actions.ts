"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  feasibilityInputsSchema,
  feasibilityReportSchema,
  type FeasibilityAssessment,
} from "@/lib/feasibility";

const assessmentSchema = z.object({
  projectId: z.string().uuid(),
  inputs: feasibilityInputsSchema,
  report: feasibilityReportSchema,
});

export async function listFeasibilityAssessments(projectId: string) {
  if (!z.string().uuid().safeParse(projectId).success)
    return { assessments: [] as FeasibilityAssessment[], error: "Invalid project." };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { assessments: [] as FeasibilityAssessment[], error: "Please sign in again." };
  const { data, error } = await client
    .from("feasibility_assessments")
    .select("id,created_at,inputs,report")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { assessments: [] as FeasibilityAssessment[], error: "Could not load feasibility reviews." };
  return { assessments: data as FeasibilityAssessment[], error: "" };
}

export async function saveFeasibilityAssessment(input: unknown) {
  const parsed = assessmentSchema.safeParse(input);
  if (!parsed.success) return { error: "The feasibility report is invalid and was not saved." };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  const { data: project } = await client.from("projects").select("id").eq("id", parsed.data.projectId).maybeSingle();
  if (!project) return { error: "This project is unavailable." };
  const { data, error } = await client
    .from("feasibility_assessments")
    .insert({
      project_id: parsed.data.projectId,
      inputs: parsed.data.inputs,
      report: parsed.data.report,
    })
    .select("id,created_at,inputs,report")
    .single();
  return error || !data
    ? { error: "Could not save the feasibility review. Your answers are still on screen." }
    : { assessment: data as FeasibilityAssessment };
}

export async function deleteFeasibilityAssessment(projectId: string, id: string) {
  if (!z.string().uuid().safeParse(projectId).success || !z.string().uuid().safeParse(id).success)
    return { error: "Invalid feasibility review." };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  const { error } = await client
    .from("feasibility_assessments")
    .delete()
    .eq("id", id)
    .eq("project_id", projectId);
  return error ? { error: "Could not delete this feasibility review." } : {};
}
