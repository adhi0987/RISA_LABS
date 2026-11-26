# CampusFest Growth Center

Attendee-growth command center for CampusFest (Challenge A, RISA Growth APM assignment): funnel analytics with as-of-date snapshots, campaign and task management, and an embedded AI Growth Analyst.

> Work in progress. The full README (research, assumptions, calculations, setup, testing, limitations) is being written.

## Quick start

```bash
npm install
# .env.local needs: DATABASE_URL (Supabase session pooler, port 5432), GEMINI_API_KEY, GEMINI_MODEL_PRIMARY, GEMINI_MODEL_FALLBACK
npx tsx --env-file=.env.local scripts/setup-db.ts   # schema + original dataset
npm run dev
npm test                                             # golden-number tests against the original dataset
```
