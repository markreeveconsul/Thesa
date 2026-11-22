# Quick Setup Guide - Feasibility Check

## 🚀 Three Steps to Enable Feasibility Reviews

### Step 1: Get a Groq API Key

1. Visit [https://console.groq.com/](https://console.groq.com/)
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (you'll only see it once)

### Step 2: Add Key to Backend Environment

**Windows:**
1. Open `backend\.env` in Notepad or your code editor
2. Find the line: `FEASIBILITY_GROQ_API_KEY=`
3. Paste your key after the `=`:
   ```
   FEASIBILITY_GROQ_API_KEY=gsk_your_actual_key_here
   ```
4. Save the file

**⚠️ Security:**
- Never commit this file to version control
- Never add this key to `frontend/.env.local`
- Keep this key private

### Step 3: Apply Supabase Migration

This is only needed for cloud-saved reports. Local browser drafts work without it.

**Option A: Using the Supabase CLI (Recommended)**
```cmd
cd frontend
npx supabase db push
```

**Option B: Manual SQL**
1. Log into your Supabase dashboard
2. Go to SQL Editor
3. Open `supabase/migrations/202611210001_feasibility_assessments.sql`
4. Copy and paste the SQL
5. Click "Run"

### Step 4: Test It!

1. Double-click `Start Thesa.bat` to start the app
2. Open http://127.0.0.1:3002
3. Create or open a project
4. Click "Feasibility check" button
5. Fill in your study details
6. Check the consent box
7. Click "Create feasibility review"
8. Wait ~10-30 seconds for Groq to generate the review
9. Your report should appear with assessments and next steps!

---

## 🔍 Troubleshooting

### "Cannot reach the feasibility service"
- Make sure `Start Thesa.bat` is running
- Check that port 8000 isn't blocked
- Look in `.thesa-run/backend-error.log` for Python errors

### "Otto could not assess feasibility"
- Verify your Groq API key is set correctly in `backend/.env`
- Check Groq account has available quota
- Look in `.thesa-run/backend-error.log` for the actual error

### Report not saving after reload
- For browser drafts: Check browser allows localStorage for 127.0.0.1
- For cloud projects: Make sure Supabase migration was applied
- Check browser console (F12) for errors

### "No report was saved" after review completes
- This means the Groq model returned invalid citations
- The model might have referenced sources you didn't upload
- Try again with clearer study details or uploaded sources

---

## ⚙️ Optional Configuration

You can customize the Groq model in `backend/.env`:

```bash
# Default model (free tier, fast)
FEASIBILITY_GROQ_MODEL=meta-llama/llama-3.3-70b-versatile

# Alternative models:
# FEASIBILITY_GROQ_MODEL=mixtral-8x7b-32768
# FEASIBILITY_GROQ_MODEL=llama-3.1-70b-versatile
```

See [Groq models list](https://console.groq.com/docs/models) for options.

---

## 📊 What You'll Get

Each feasibility review includes:

1. **Executive Summary** - Overview of workability
2. **Six Dimensions** - Detailed assessment of:
   - Scope
   - Method fit
   - Access to participants/data
   - Timeline feasibility
   - Resource requirements
   - Ethics and permissions
3. **Risks** - Potential issues with mitigation suggestions
4. **Next Steps** - Concrete actions to improve feasibility
5. **Missing Information** - Gaps that need clarification
6. **Source Citations** - References to your uploaded documents (if provided)

All reports are saved and can be reviewed later from the history panel.

---

## 🎓 Best Practices

- **Upload relevant sources first** for better-grounded advice
- **Be specific** in your study plan (vague plans get vague feedback)
- **Mark uncertain details** in the "Anything uncertain?" field
- **Run multiple reviews** as your plan evolves
- **Compare reports** in the history to track progress

---

## 🆘 Need Help?

Check these logs if something goes wrong:
- `.thesa-run/backend-error.log` - Python/FastAPI errors
- `.thesa-run/backend.log` - Request logs
- Browser console (F12 → Console) - Frontend errors

The feasibility check is a **guidance tool**, not an approval decision. Use it to think through practical constraints and refine your plan.
