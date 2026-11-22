# Environment Setup Example

## Backend .env Configuration

Your `backend/.env` file should look like this after adding your Groq API key:

```bash
# Local document service. Never expose this unauthenticated development service publicly.
DOCUMENT_MAX_UPLOAD_MB=25
DOCUMENT_MAX_PAGES=300
DOCUMENT_PARSE_TIMEOUT=45

# Gemini API connection (server-only; never put the key in frontend code).
GEMINI_API_KEY=your-gemini-key-here-if-using-otto
GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
AI_CHAT_MODEL=gemini-2.0-flash-exp
AI_EMBED_MODEL=text-embedding-004
AI_EMBED_DIMENSIONS=768
# Similarity floor for evidence retrieval; tune with representative test documents.
AI_RETRIEVAL_MIN_SCORE=0.3

# Separate Groq provider for feasibility reviews; does not change Otto's Gemini settings.
FEASIBILITY_GROQ_API_KEY=gsk_your_actual_groq_key_here
FEASIBILITY_GROQ_BASE_URL=https://api.groq.com/openai/v1
FEASIBILITY_GROQ_MODEL=meta-llama/llama-3.3-70b-versatile

DOCUMENT_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:3002,http://localhost:3002,http://127.0.0.1:3012,http://localhost:3012
```

## Important Notes

### Groq API Key
- **Where to get it**: https://console.groq.com/keys
- **Required for**: Feasibility reviews to work
- **Format**: Starts with `gsk_`
- **Never**: Commit this to git or put in frontend `.env.local`

### Groq Model Options

The default model in `.env.example` is `openai/gpt-oss-20b`. However, for better results, consider these options:

**Recommended (balanced speed & quality):**
```bash
FEASIBILITY_GROQ_MODEL=meta-llama/llama-3.3-70b-versatile
```

**Fast (good for testing):**
```bash
FEASIBILITY_GROQ_MODEL=llama-3.1-8b-instant
```

**Higher quality (slower):**
```bash
FEASIBILITY_GROQ_MODEL=llama-3.1-70b-versatile
FEASIBILITY_GROQ_MODEL=mixtral-8x7b-32768
```

Check current models at: https://console.groq.com/docs/models

### Gemini API Key (Optional for Otto)
- **Where to get it**: https://aistudio.google.com/apikey
- **Required for**: Otto source-grounded chat
- **Not needed for**: Feasibility reviews (uses separate Groq)
- **Free tier**: Available with quota limits

### Model Changes
You can update models without code changes:
1. Edit `backend/.env`
2. Restart `Start Thesa.bat`
3. Models take effect immediately

### Security Checklist
- ✅ `.env` file is in `.gitignore`
- ✅ Never push API keys to GitHub
- ✅ Use separate keys for development vs production
- ✅ Review Groq and Gemini data-use policies before sending thesis material

## Frontend .env.local Configuration

Your `frontend/.env.local` should look like this:

```bash
# Site configuration
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3002

# Supabase connection (get from Supabase dashboard)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=eyJhb...your-key

# Allow browser drafts in production demo (NOT for real deployment)
ALLOW_BROWSER_DRAFTS=false

# Backend API endpoint
NEXT_PUBLIC_DOCUMENT_API_URL=http://127.0.0.1:8000

# AI configuration (optional overrides)
# These are set in backend/.env by default:
# AI_CHAT_MODEL=gemini-2.0-flash-exp
# AI_EMBED_MODEL=text-embedding-004
# AI_EMBED_DIMENSIONS=768
# AI_RETRIEVAL_MIN_SCORE=0.3
```

### Important
- **Never** add `FEASIBILITY_GROQ_API_KEY` to frontend env
- **Never** add `GEMINI_API_KEY` to frontend env
- **Only** `NEXT_PUBLIC_*` variables are exposed to the browser

## Quick Verification

After setting up:

1. Check backend has Groq key:
   ```bash
   # Windows CMD:
   type backend\.env | find "FEASIBILITY_GROQ_API_KEY"
   
   # Should show:
   # FEASIBILITY_GROQ_API_KEY=gsk_...
   ```

2. Start services:
   ```bash
   # Double-click Start Thesa.bat
   # Or manually:
   cd frontend
   npm run dev -- --port 3002
   ```

3. Test feasibility:
   - Open http://127.0.0.1:3002
   - Create a project
   - Click "Feasibility check"
   - Submit a review
   - Should get results in 10-30 seconds

## Troubleshooting

**"Module not found" errors**
→ Run `npm ci` in `frontend` directory

**Backend won't start**
→ Check Python virtual environment: `backend\.venv\Scripts\python.exe --version`

**Groq returns errors**
→ Verify key format starts with `gsk_`
→ Check account quota at https://console.groq.com

**Supabase connection fails**
→ Verify URL and key in `frontend/.env.local`
→ Check project is not paused in Supabase dashboard

**Need help?**
→ Check `.thesa-run/backend-error.log`
→ Check browser console (F12)
→ Review `docs/AI_SETUP.md` and `docs/FEASIBILITY_SETUP.md`
