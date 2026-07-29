# Pitchside

A social network for players, teams, supporters, coaches, and scouts/agents,
covering Rugby, Football, Cricket, Netball, and Hockey. Player, team,
supporter, coach, and scout profiles all link together: players and coaches
request to join a team, the team accepts and publishes lineups, supporters
follow along and post matchday updates, scouts search for talent and request
access to a player's contract/contact details, chatting once accepted. Teams
can also go live during a match and let supporters crowd-submit the score in
real time.

## Real accounts

Every person creates a real account with an email and password. Sign-up now
runs in clear steps: **1)** pick a profile type, **2)** fill in general
details that apply no matter what kind of profile this is - profile photo,
cover photo, country/suburb, contact email/phone, social links - **3)** for
Player and Team only, sport-specific details (sport, position(s), squad
number / category). After that, opening the app takes you straight to your
own profile - no chooser, no list of other people's profiles. **One account
= one profile.** If someone needs a second profile (e.g. they're both a
player and a supporter), that currently means a second account with a
different email; letting one account hold multiple linked profiles is a
reasonable next feature if you want it.

Passwords are hashed with bcrypt before they ever touch the database - the
plain password is never stored. Sessions are JSON Web Tokens (JWTs), valid
for 90 days, stored in the browser's `localStorage` and sent as an
`Authorization: Bearer <token>` header on every request that needs to know
who's asking.

### Required environment variable

This now needs a `SESSION_SECRET` in Railway (Variables tab) - a long random
string used to sign login sessions. Without it, login/register will fail
with a clear error rather than silently using an insecure default. Generate
one the same way you did `ADMIN_SECRET`.

## Photos & documents

- **Profile photo:** every profile type can add one, shown as a circular
  avatar throughout the app.
- **Cover photo:** every profile type can add a wide banner image, shown
  behind the profile photo.
- **Photo gallery:** Player and Team profiles can add multiple photos (career
  moments, team photos). Shown as a thumbnail grid on the profile.
- **Sport CV (Player only):** upload a Word or PDF document (max 8MB), shown
  as a downloadable file chip rather than a preview.

Photos and documents are resized/stored as base64 inside the database (CVs
aren't resized - can't resize a document - just size-capped). Fine at this
scale; move to real object storage (e.g. an S3-compatible bucket) if these
features get heavy use - base64-in-a-database doesn't scale indefinitely.

## General profile fields (all profile types)

Every profile type - Player, Team, Supporter, Coach, Scout - now shares:
profile photo, cover photo, **country + suburb/city** (structured, not free
text), **contact email/phone** (public - meant to be shared, distinct from a
player's private scouting contact field below), and **social links**
(Facebook, Instagram, YouTube, X/Twitter, LinkedIn), shown as an icon row on
the profile.

## What's built

- **Player profile:** photo, cover photo, gallery, sport CV upload (Word/PDF),
  bio (weight, height, age, hobbies), sport (Rugby, Football, Cricket,
  Netball, or Hockey), position(s) picked from a sport-specific dropdown list
  (e.g. Prop/Hooker for Rugby), country + suburb, public contact email/phone,
  social links, career history, sport-aware stats (labels change based on
  chosen sport - e.g. "Tries/Conversions" for Rugby, "Goals/Assists" for
  Football, "Runs/Wickets" for Cricket), achievements, searchable attributes
  (e.g. "two-footed"), join-a-team flow, private contract/salary/scouting-
  contact fields (only surfaced to scouts once access is granted - kept
  separate from the public contact fields above)
- **Team profile:** (internally still keyed as "club" in the data - see note
  below) photo, cover photo, gallery, sponsors (logo + name), sport, category
  (School/Club/Professional/Social/Action sport), founding year, history/bio,
  trophies, current log/standing, country + suburb, contact email/phone,
  social links, player roster management, coaching staff roster and
  requests, upcoming fixtures (league, match title, opponent, date/time,
  location), lineup publishing with a formation-style picker (one dropdown
  per position slot, since more than one player can share a position),
  "Share lineup" (opens the device's native share sheet or copies the lineup
  as text - see note below), news posts, live match hosting
- **Supporter profile:** photo, bio, supporter story, following multiple
  teams, matchday photo/score uploads, live score submissions
- **Coach profile:** photo, bio, qualifications, years of experience,
  specialization, achievements, request to join a team's coaching staff
  (separate from the player roster, own accept/decline flow)
- **Scout/agent profile:** photo, bio, achievements, talent discovery
  (search/filter by name, sport, position, region, and player-listed
  attributes), access-request flow gated by player approval, private player
  details once accepted, direct chat with linked players
- **Live matches:** a team goes live, supporters submit scores, the
  most-submitted score becomes the displayed live score, ending the match
  auto-posts the final score to the feed
- **Trial/pricing:** 30-day trial per profile type, soft paywall after expiry
  (server-enforced, not just hidden in the UI), demo "subscribe" button (see
  billing note below)
- **Admin / super users:** read-only usage dashboard (profile counts, trial
  vs paid, post activity, pending requests, recent signups). Admin accounts
  never see a trial banner and are never blocked by the paywall. See "Admin
  accounts" below.
- **Friends:** a general-purpose connection between any two profiles,
  separate from the specific relationships above (roster, scout access,
  coaching staff). Send a request, the other person accepts or declines,
  either side can remove the connection later. A dedicated "Friends" tab
  handles requests and search; the "Feed" tab has a Public/Friends toggle -
  Friends shows only your own posts plus posts from accepted friends.
- **Viewing someone's profile:** clicking a name anywhere (friends list,
  friend requests, search, a scout's talent discovery or accepted-players
  list) opens a read-only view of that profile - stats, career, gallery,
  achievements, everything they've made public. A player's contract, asking
  salary, and contact details are only included for the player themselves or
  a scout they've explicitly accepted - this is enforced by the **server**,
  not just hidden in the UI, so it can't be read out of the network response
  either.

**Note on "Team" vs "club":** the person-facing label is "Team" everywhere in
the UI, but the underlying `type` value stored in the database is still
`"club"` for this profile type, to avoid a bigger migration. Likewise,
player stats are stored under the original field names (`tries`,
`conversions`, etc.) regardless of sport, and only the *displayed label*
changes - so a cricket player's "Runs" are technically sitting in a field
called `tries` under the hood. Both are deliberate trade-offs; flag it if
you'd rather have this fully renamed at the data level.

**Billing is simulated.** There's a "Subscribe (demo)" button that flips a
profile to `plan = 'paid'` with no real payment involved. Wire up a real
payment gateway (Stripe, PayFast, etc.) before charging anyone for real.

**"Share lineup" is not automatic posting to Facebook/Instagram/etc.** Real
automatic posting to those platforms requires registering a developer app
with each one individually and getting API/access tokens from them - that's
a business decision (and paperwork) only you can make, not something
achievable from inside the app. What's built instead: the button opens the
visitor's own device share sheet (their phone already knows how to hand text
to Facebook, WhatsApp, Instagram, etc.) or, on browsers without that,
copies a pre-formatted lineup as text to paste in manually. If real
automatic posting matters later, the next step would be registering for
Meta's Graph API (Facebook/Instagram) specifically.

## Project structure

```
pitchside/
  server/   Express API + Postgres (serves the built client too)
  client/   React app (Vite)
```

## Local development

```bash
# terminal 1 - API server
cd server
npm install
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pitchside \
SESSION_SECRET=some-long-random-string \
ADMIN_SECRET=another-long-random-string \
npm run dev

# terminal 2 - frontend with hot reload, proxies /api to the server above
cd client
npm install
npm run dev
```

## Deploying to Railway

Same as before - push to GitHub, Railway auto-deploys from the connected
repo, with a Postgres add-on in the same project supplying `DATABASE_URL`
automatically. Two things to set yourself in Railway's Variables tab:

| Variable | Set by | Notes |
|---|---|---|
| `DATABASE_URL` | Railway (automatic) | From the Postgres add-on |
| `PORT` | Railway (automatic) | Don't hardcode a port |
| `SESSION_SECRET` | **You** | Long random string, signs login sessions |
| `ADMIN_SECRET` | **You** | Long random string, gates admin account creation |

## Admin accounts

Admin accounts bypass the trial/paywall entirely and unlock a read-only
stats dashboard. There's no "Admin" option in the public sign-up screen -
creating one requires `ADMIN_SECRET`, which only you know.

Run this once per admin account you want (replace the URL, secrets, and
details):

```bash
curl -X POST https://your-app.up.railway.app/api/admin/create-profile \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: YOUR_ADMIN_SECRET" \
  -d '{"email":"you@example.com","password":"a-real-password-8-chars-plus","name":"Chris"}'
```

That creates both the login (email/password) and the admin profile in one
step. From then on, just log in at the normal login screen with that email
and password - no browser console tricks needed, it behaves like any other
account except it never sees a trial banner and can view `/api/admin/stats`.

**On Windows PowerShell**, `curl` is aliased to `Invoke-WebRequest`, which
doesn't understand this syntax. Use `curl.exe` instead of `curl` to reach
the real curl, or use PowerShell's native equivalent:

```powershell
Invoke-RestMethod -Uri "https://your-app.up.railway.app/api/admin/create-profile" -Method Post -ContentType "application/json" -Headers @{"x-admin-secret"="YOUR_ADMIN_SECRET"} -Body '{"email":"you@example.com","password":"a-real-password-8-chars-plus","name":"Chris"}'
```

## Note on data from before this update

This update replaced the old device-based "owner token" pseudo-auth with
real accounts. Any profiles created before this change (during earlier
testing) have no linked user account, so nobody can log into or edit them
anymore - they'll still appear in listings and the feed as historical/demo
content, but they're effectively frozen. If you want a clean slate, the
simplest option is truncating the `profiles`, `posts`, `access_grants`,
`messages`, `live_matches`, `friendships`, and `events` tables via Railway's
Postgres data tab (or a one-off `psql` session) and starting fresh with real
accounts only.

## What to build next

Roughly in order of value:
1. **Stories** (24-hour expiring photo/video updates, viewable by friends) -
   scoped out of an earlier round deliberately; still not built
2. Real automatic posting to Facebook/Instagram via Meta's Graph API,
   replacing the share-sheet approach "Share lineup" currently uses (needs
   you to register a developer app with Meta first - see note above)
3. A real payment gateway (Stripe, PayFast) wired to the existing `plan`/
   `trial_started_at` columns, replacing the demo "subscribe" button
4. Letting one account hold more than one profile (e.g. player + supporter)
5. Password reset / "forgot password" flow (currently there isn't one)
6. A directory/search page to browse teams and players generally
7. Comments/reactions on posts
8. Real object storage for images/documents instead of base64-in-database
9. Push notifications (new join request, new message, new friend request,
   match went live)
