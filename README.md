# ProcessPath (Prototype)

Information guidance web app for step-by-step institutional processes.

## MVP scope in this prototype

- Public process discovery (keyword, category, institution, region)
- Favorite processes + favorites-only filtering for faster repeat search
- Detailed process + step checklist
- Guest progress tracking in browser storage
- Print and download checklist
- Community-contributed source model (`community-contributed`)
- i18n-ready UI (English + Amharic)
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

## Floating AI process chat

This project includes a floating AI chat in the bottom-right corner. It:

- searches across multiple process guides,
- returns one aggregated response,
- shows referenced process sources at the bottom of each AI message.

To enable Gemini responses, set this in `.env.local`:

```bash
VITE_GEMINI_API_KEY="your_gemini_api_key"
```

Model used: `gemini-2.5-flash` via Vercel AI SDK (`ai` + `@ai-sdk/google`).

## Supabase setup

1. Create a Supabase project.
2. Add keys to `.env.local`.
3. Run migration in `supabase/migrations/20260425093000_initial.sql`.

## Notes

- Without Supabase env vars, app works in guest mode using `localStorage`.
- Current data is mocked in `src/data.mock.ts` for prototype/demo use.
