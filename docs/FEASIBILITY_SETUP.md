# Feasibility checker setup

The feasibility checker runs through the local FastAPI document service. It calls Groq for the structured review; Otto source chat continues to use its separate Gemini provider and settings.

## Configure Groq

1. Create a Groq API key in your Groq account.
2. Copy `backend/.env.example` to `backend/.env` if needed.
3. Set `FEASIBILITY_GROQ_API_KEY` in `backend/.env`. The default model is `openai/gpt-oss-20b`; change `FEASIBILITY_GROQ_MODEL` if you select another model available to your account.
4. Restart **Start Thesa.bat** so the FastAPI process loads the new environment.

Never place this key in `frontend/.env.local`, share it in chat, or commit `backend/.env`. The browser sends form answers and at most ten relevant extracted source excerpts to the local service; only the service calls Groq. Groq is an external provider, so check its current model availability, quotas, pricing, and data-use terms before using sensitive research material.

## Apply the report migration

Cloud reports require `supabase/migrations/202611210001_feasibility_assessments.sql`. From the repository root, run the project's pinned CLI after linking it to your Supabase project:

~~~powershell
.\frontend\node_modules\.bin\supabase.cmd db push
~~~

The migration creates a project-owned report table with RLS. Browser-draft reports are stored only in that browser's localStorage and are not uploaded to Supabase.

## Test it

Open a project, choose **Feasibility check** in the project navigation or **Check feasibility** in Otto. Fill in at least the topic, read the provider disclosure, and consent before submitting. Sources are optional. A source-backed statement includes a link to the original file location; without relevant sources, the report is based on the student's answers and does not cite files.

The local endpoint accepts only local requests and is not safe to expose publicly. A hosted deployment needs an authenticated, reachable backend route before this feature can run online.
