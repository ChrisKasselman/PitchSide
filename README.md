# Pitchside

A social network for players, clubs/schools, supporters, and scouts/agents.
Player, club, supporter, and scout profiles all link together: players
request to join a club, clubs accept and publish lineups, supporters follow
along and post matchday updates, scouts request access to a player's
contract/contact details and can chat once accepted. Clubs can also go live
during a match and let supporters crowd-submit the score in real time.

This is a working prototype, not a finished product. In particular:
- There's no real login yet. Each profile is protected by a random "owner
  token" generated in your browser and stored in `localStorage`, so only the
  device that created a profile can edit it or post as it. That's enough to
  stop accidental cross-editing while testing, but it is **not** real
  authentication (a new browser/incognito window = a "different person" with
  no way back into an old profile). Swap this for real accounts before you
  put this in front of the public.
- Photos are stored as base64 inside the database (resized client-side
  first). Fine for a prototype; move to real object storage (e.g. an S3-
  compatible bucket) once volume grows.
- **Billing is simulated.** Every profile gets a real 30-day trial tracked
  server-side (`trial_started_at`, `plan` columns on `profiles`), and once it
  expires the API blocks new posts, join requests, access requests, and live
  matches with a 402 response - reading/viewing is never blocked. There's a
  "Subscribe (demo)" button that just flips `plan` to `'paid'` with no real
  payment involved. Wire up a real payment gateway (Stripe, PayFast, etc.)
  before charging anyone for real.

## What's built

- **Player profile:** bio (weight, height, age, hobbies), position(s), career
  history, stats (games played, tries, conversions, player-of-the-match),
  achievements, join-a-club flow, contract/salary/contact fields (only
  surfaced to scouts once access is granted)
- **Club/school profile:** founding year, trophies, current log/standing,
  roster management, lineup publishing, news posts, live match hosting
- **Supporter profile:** bio, supporter story, following multiple clubs,
  matchday photo/score uploads, live score submissions
- **Scout/agent profile:** bio, achievements, player search, access-request
  flow gated by player approval, private player details once accepted,
  direct chat with linked players
- **Live matches:** a club goes live, supporters submit scores, the
  most-submitted score becomes the displayed live score, ending the match
  auto-posts the final score to the feed
- **Trial/pricing:** 30-day trial per profile type, soft paywall after expiry,
  demo "subscribe" button (see billing note above)

## Project structure

```
pitchside/
  server/   Express API + Postgres (serves the built client too)
  client/   React app (Vite)
```

The server serves the API under `/api/*` and the built frontend for
everything else, so this deploys as a single Railway service.

## Local development

You'll need Node 18+ and a local Postgres (or a Railway Postgres you connect
to remotely).

```bash
# terminal 1 - API server
cd server
npm install
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pitchside npm run dev

# terminal 2 - frontend with hot reload, proxies /api to the server above
cd client
npm install
npm run dev
```

Open the client dev URL Vite prints (usually `http://localhost:5173`).

## Deploying to Railway

You said GitHub is already linked to Railway, so:

1. **Push this project to a GitHub repo.**
   ```bash
   git init
   git add .
   git commit -m "Pitchside prototype"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **In Railway:** New Project → Deploy from GitHub repo → pick this repo.

3. **Add a Postgres database:** in the same Railway project, click "New" →
   "Database" → "Add PostgreSQL". Railway automatically injects a
   `DATABASE_URL` environment variable into your app service - you don't need
   to copy/paste it yourself, as long as the database and the app are in the
   same Railway project.

4. **Check the build/start commands.** Railway auto-detects Node via
   Nixpacks and will run:
   - Install: `npm install` (root)
   - Build: `npm run build` (installs + builds the client, installs server deps)
   - Start: `npm start` (runs `node server/index.js`)

   These are already defined in the root `package.json`, so this should just
   work. If Railway's dashboard shows different commands under
   Settings → Deploy, you can paste these in manually to match.

5. **Deploy.** Railway will build and give you a public URL
   (`https://your-app.up.railway.app`). The server creates its database
   tables automatically on first boot (see `server/db.js`).

6. **Custom domain (optional):** Settings → Networking → add a domain, once
   you're ready.

### Environment variables

| Variable | Set by | Notes |
|---|---|---|
| `DATABASE_URL` | Railway (automatic) | Connection string for the Postgres add-on |
| `PORT` | Railway (automatic) | The server reads this; don't hardcode a port |

You don't need to set either of these manually in a standard Railway setup.

## What to build next

Roughly in order of value:
1. Real accounts (email/password or OAuth) instead of the browser-token trick
2. A real payment gateway (Stripe, PayFast) wired to the existing `plan`/
   `trial_started_at` columns, replacing the demo "subscribe" button
3. A directory/search page to browse clubs and players generally
4. Match schedules (not just posted lineups/live matches after the fact)
5. Comments/reactions on posts
6. Object storage for images instead of base64-in-database
7. Push notifications (new join request, new message, match went live)
