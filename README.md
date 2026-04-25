# ProcessPath (Prototype)

Information guidance web app for step-by-step institutional processes.

## MVP scope in this prototype

- Public process discovery (keyword, category, institution, region)
- Favorite processes + favorites-only filtering for faster repeat search
- Detailed process + step checklist
- Local SQLite (browser) persistence for progress, favorites, and uploaded guides
- Print and download checklist
- Community-contributed source model (`community-contributed`)
- i18n-ready UI (English + Amharic)
- One-time migration of legacy localStorage data into SQLite

## Stack

- React + TypeScript
- Vite+
- SQL.js (SQLite in browser)

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

## Notes

- Existing `localStorage` keys are imported once into SQLite automatically.
- Current data is mocked in `src/data.mock.ts` for prototype/demo use.
