import { redirect } from "next/navigation";
import { Dashboard } from "@/components/Dashboard";
import { getSupabaseConfig, requireBrowserDraftMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/workspace";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ library?: string }>;
}) {
  const params = await searchParams;
  if (!getSupabaseConfig()) {
    requireBrowserDraftMode();
    return <Dashboard local projects={[]} autoOpen={params.library !== "1"} />;
  }
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/auth");
  const [projectsResult, sectionsResult] = await Promise.all([
    client.from("projects").select("*").order("updated_at", { ascending: false }),
    client.from("sections").select("project_id,content"),
  ]);
  if (projectsResult.error || sectionsResult.error)
    throw new Error("Could not load your thesis library.");
  return (
    <Dashboard
      local={false}
      projects={(projectsResult.data ?? []) as Project[]}
      initialSections={sectionsResult.data ?? []}
    />
  );
}
