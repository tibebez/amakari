# ProcessPath (Prototype)

Information guidance web app for step-by-step institutional processes.

## MVP scope in this prototype

- Public process discovery (keyword, category, institution, region)
- Detailed process + step checklist
- Guest progress tracking in browser storage
- Print and download checklist
- Community-contributed source model (`community-contributed`)
- i18n-ready UI (English + Spanish)
- Supabase-ready schema and client setup

## Stack

- React + TypeScript
- Vite+
- Supabase (Auth + Postgres)

## Run locally

```bash
vp install
cp .env.example .env.local
vp dev
```

Then open the local URL shown by Vite+.

## Supabase setup

1. Create a Supabase project.
2. Add keys to `.env.local`.
3. Run migration in `supabase/migrations/20260425093000_initial.sql`.

## Notes

- Without Supabase env vars, app works in guest mode using `localStorage`.
- Current data is mocked in `src/data.mock.ts` for prototype/demo use.
