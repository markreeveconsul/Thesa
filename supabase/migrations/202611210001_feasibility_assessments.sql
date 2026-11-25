create table public.feasibility_assessments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  created_at timestamptz not null default now()
);
create index feasibility_assessments_project_created_idx
  on public.feasibility_assessments(project_id, created_at desc);
alter table public.feasibility_assessments enable row level security;
alter table public.feasibility_assessments force row level security;
create policy feasibility_assessments_owner on public.feasibility_assessments
  for all to authenticated
  using (private.owns_project(project_id))
  with check (private.owns_project(project_id));
revoke all on public.feasibility_assessments from anon, authenticated;
grant select, insert, delete on public.feasibility_assessments to authenticated;
grant all on public.feasibility_assessments to service_role;
