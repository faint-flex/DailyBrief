# Daily Brief

Your morning brief as its own app on your phone: what needs you in email, a few
dinner ideas you can put on the grocery list with one tap, and live weather.
Installs on your home screen like an app and still shows the last brief with no
signal.

<img src="docs/screenshot.png" alt="Daily Brief: weather, email that needs you, dinner ideas with Add to list" width="320">

Claude's morning run writes the brief at about 7:50am and sends it here. The
weather is fetched live on your phone from [Open-Meteo](https://open-meteo.com)
(free, no key), so it is current whenever you open the app.

## Put it on your phone

It runs free on Cloudflare, in the same account as Grocerylist. From this folder:

```bash
npm install     # one-time, fetches the deploy tool
npm run setup   # signs you in, creates storage, deploys, makes your key
```

At the end it prints:

1. **A link with your key** — open it on your phone, then add it to your home
   screen (iPhone: Share → *Add to Home Screen*; Android: menu → *Install app*).
   If the installed app asks for a key, paste the part after `key=`.
2. **`DAILY_BRIEF_KEY=…`** — add this to your Claude project as an environment
   variable (Project settings → Cloud environment → gear icon) so the morning
   run can send the brief. Don't paste the key into a chat.

It also asks for your Grocerylist share code (the 20 letters on its Share tab)
so **Add to list** works. Press Enter to skip; run `npm run setup` again later
to add it. After the first time, `npm run deploy` pushes changes.

The key is kept in `.brief-key` in this folder (never committed). To change it,
delete that file and run `npm run setup` again; then update the phone and the
project variable.

## Sending a brief

```bash
curl -fsS -X POST "$DAILY_BRIEF_URL/api/brief" \
  -H "Authorization: Bearer $DAILY_BRIEF_KEY" \
  -H "Content-Type: application/json" \
  --data @brief.json
```

The brief is JSON shaped like [docs/example-brief.json](docs/example-brief.json).
Every field is optional, but there has to be something in it:

| Field | What it is |
|---|---|
| `date` | `YYYY-MM-DD`. Defaults to today in Pacific time. Sending again the same day replaces it. |
| `greeting` | One line under "Good morning". |
| `email.needsYou` | Up to 12 of `{ from, subject, why }`, or plain strings. |
| `email.cleanup` | Junk senders to suggest clearing, `{ sender, count }`. Shown only; the app never touches your mail. |
| `email.note` | Shown when nothing needs you, e.g. "Nothing new". |
| `dinners` | Up to 5 of `{ name, minutes, why, url, ingredients: ["1 lb beef", …] }`. |
| `notes` | Anything else worth a line. |

The last 14 days are kept; the app has a picker for earlier ones.

## Add to list

Each dinner with ingredients (or a recipe link) gets an **Add to list** button.
It puts the dinner in Grocerylist's shared cookbook and on the shopping list,
the same way Grocerylist's own *Add to list* does, and won't add it twice.
Daily Brief reaches Grocerylist through a Cloudflare service binding, so your
Grocerylist worker must be named `grocerylist` in the same account. The code
that edits the list is copied from Grocerylist; see
[vendor/grocerylist/README.md](vendor/grocerylist/README.md).

## Privacy

A brief summarizes your inbox, so everything under `/api/` needs the key. The
page itself is public but empty without it. Your place for the weather stays on
your phone.

## Working on it

```bash
npm test                                            # no install needed
npx wrangler dev -c wrangler.toml -c ../grocerylist/wrangler.toml   # both apps locally
```

For local runs, put `BRIEF_KEY=…` (and optionally `GROCERY_CODE=…`) in `.dev.vars`.
