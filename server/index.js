const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool, initSchema } = require("./db");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" })); // raised to fit profile pictures + a small photo gallery

const PRICING = { supporter: 25, player: 50, club: 250, scout: 500, coach: 50 };
const TRIAL_DAYS = 30;
const SESSION_SECRET = process.env.SESSION_SECRET;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---- auth helpers ----

function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, SESSION_SECRET, { expiresIn: "90d" });
}

// Attaches req.userId / req.userEmail if a valid token is present. 401s otherwise.
function authenticate(req, res, next) {
  if (!SESSION_SECRET) return res.status(500).json({ error: "SESSION_SECRET is not configured on the server. Set it in Railway." });
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Please log in again." });
  }
}

async function getMyProfileRow(userId) {
  const { rows } = await pool.query("SELECT * FROM profiles WHERE user_id = $1", [userId]);
  return rows[0] || null;
}
async function getProfileRow(id) {
  const { rows } = await pool.query("SELECT * FROM profiles WHERE id = $1", [id]);
  return rows[0] || null;
}

function trialExpired(row) {
  if (row.is_admin) return false; // super users never expire and never pay
  if (row.plan !== "trial") return false;
  const daysUsed = (Date.now() - new Date(row.trial_started_at).getTime()) / 86400000;
  return daysUsed > TRIAL_DAYS;
}

// Loads the calling user's own profile, optionally checks it's the right
// type for this action, and blocks the action if their trial has expired.
// Centralizes what used to be repeated ownerToken checks on every route.
async function requireCallerProfile(req, res, expectedType) {
  const row = await getMyProfileRow(req.userId);
  if (!row) { res.status(404).json({ error: "You don't have a profile yet." }); return null; }
  if (expectedType && row.type !== expectedType) { res.status(403).json({ error: `This action requires a ${expectedType} profile.` }); return null; }
  if (trialExpired(row)) {
    res.status(402).json({ error: `Your free trial ended. Subscribe for R${PRICING[row.type]}/month to keep using Pitchside.`, code: "TRIAL_EXPIRED" });
    return null;
  }
  return row;
}

const rowToProfile = (row) => ({
  ...row.payload,
  id: row.id,
  plan: row.plan,
  isAdmin: row.is_admin,
  trialStartedAt: row.trial_started_at,
  trialDaysLeft: Math.max(0, TRIAL_DAYS - Math.floor((Date.now() - new Date(row.trial_started_at).getTime()) / 86400000)),
  monthlyPrice: PRICING[row.type] ?? null,
});
const rowToPost = (row) => ({ ...row.payload, id: row.id });
const rowToLiveMatch = (row) => ({ ...row.payload, id: row.id, clubId: row.club_id, status: row.status });

// ---- auth endpoints ----

app.post("/api/auth/register", async (req, res) => {
  try {
    if (!SESSION_SECRET) return res.status(500).json({ error: "SESSION_SECRET is not configured on the server." });
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length) return res.status(409).json({ error: "An account with that email already exists. Try logging in instead." });

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uid();
    await pool.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [userId, email, passwordHash]);
    const token = signToken({ id: userId, email });
    res.status(201).json({ token, email });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not create account." }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    if (!SESSION_SECRET) return res.status(500).json({ error: "SESSION_SECRET is not configured on the server." });
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (!rows.length) return res.status(401).json({ error: "Incorrect email or password." });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Incorrect email or password." });
    const token = signToken(rows[0]);
    res.json({ token, email: rows[0].email });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not log in." }); }
});

app.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const row = await getMyProfileRow(req.userId);
    res.json({ email: req.userEmail, profile: row ? rowToProfile(row) : null });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load account." }); }
});

// ---- profiles ----

app.get("/api/profiles", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM profiles ORDER BY name ASC");
    res.json(rows.map(rowToProfile));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load profiles." }); }
});

app.get("/api/profiles/:id", async (req, res) => {
  try {
    const row = await getProfileRow(req.params.id);
    if (!row) return res.status(404).json({ error: "Profile not found." });
    res.json(rowToProfile(row));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load profile." }); }
});

app.post("/api/profiles", authenticate, async (req, res) => {
  try {
    const existing = await getMyProfileRow(req.userId);
    if (existing) return res.status(409).json({ error: "You already have a profile on this account." });

    const { profile } = req.body;
    if (!profile?.type || !profile?.name) return res.status(400).json({ error: "Missing profile fields." });
    if (profile.type === "admin") return res.status(403).json({ error: "Admin profiles can't be created this way." });

    const id = uid();
    const fullProfile = { ...profile, id };
    await pool.query(
      `INSERT INTO profiles (id, type, name, payload, user_id) VALUES ($1, $2, $3, $4, $5)`,
      [id, profile.type, profile.name, fullProfile, req.userId]
    );
    const row = await getProfileRow(id);
    res.status(201).json(rowToProfile(row));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not create profile." }); }
});

app.put("/api/profiles/me", authenticate, async (req, res) => {
  try {
    const row = await getMyProfileRow(req.userId);
    if (!row) return res.status(404).json({ error: "You don't have a profile yet." });
    const { profile } = req.body;
    const merged = { ...row.payload, ...profile, id: row.id, type: row.type };
    await pool.query(`UPDATE profiles SET name = $1, payload = $2, updated_at = now() WHERE id = $3`, [merged.name, merged, row.id]);
    const updated = await getProfileRow(row.id);
    res.json(rowToProfile(updated));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not update profile." }); }
});

// Simulated upgrade - no real payment gateway wired up yet, but this is where
// a Stripe/PayFast webhook would eventually flip a profile to plan='paid'.
app.post("/api/profiles/upgrade", authenticate, async (req, res) => {
  try {
    const row = await getMyProfileRow(req.userId);
    if (!row) return res.status(404).json({ error: "You don't have a profile yet." });
    await pool.query(`UPDATE profiles SET plan = 'paid', updated_at = now() WHERE id = $1`, [row.id]);
    const updated = await getProfileRow(row.id);
    res.json(rowToProfile(updated));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not upgrade profile." }); }
});

// ---- admin / super users ----

app.post("/api/admin/create-profile", async (req, res) => {
  try {
    if (!process.env.ADMIN_SECRET) return res.status(500).json({ error: "ADMIN_SECRET is not configured on the server." });
    if (req.get("x-admin-secret") !== process.env.ADMIN_SECRET) return res.status(403).json({ error: "Invalid admin secret." });
    if (!SESSION_SECRET) return res.status(500).json({ error: "SESSION_SECRET is not configured on the server." });

    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const name = req.body.name || "Admin";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

    const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existingUser.rows.length) return res.status(409).json({ error: "An account with that email already exists." });

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uid();
    await pool.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)", [userId, email, passwordHash]);

    const profileId = uid();
    const profile = { id: profileId, type: "admin", name };
    await pool.query(
      `INSERT INTO profiles (id, type, name, payload, user_id, plan, is_admin) VALUES ($1, 'admin', $2, $3, $4, 'paid', true)`,
      [profileId, name, profile, userId]
    );
    res.status(201).json({ message: "Admin account created. Log in with this email and password at /", email });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not create admin profile." }); }
});

async function requireAdmin(req, res) {
  const row = await getMyProfileRow(req.userId);
  if (!row || !row.is_admin) { res.status(403).json({ error: "Admin access required." }); return null; }
  return row;
}

app.get("/api/admin/stats", authenticate, async (req, res) => {
  const adminRow = await requireAdmin(req, res);
  if (!adminRow) return;
  try {
    const [byType, byPlan, postsByKind, liveByStatus, grantsByStatus, recent, allTeams] = await Promise.all([
      pool.query("SELECT type, count(*)::int AS count FROM profiles GROUP BY type"),
      pool.query("SELECT plan, count(*)::int AS count FROM profiles WHERE is_admin = false GROUP BY plan"),
      pool.query("SELECT kind, count(*)::int AS count FROM posts GROUP BY kind"),
      pool.query("SELECT status, count(*)::int AS count FROM live_matches GROUP BY status"),
      pool.query("SELECT status, count(*)::int AS count FROM access_grants GROUP BY status"),
      pool.query("SELECT id, name, type, created_at FROM profiles ORDER BY created_at DESC LIMIT 15"),
      pool.query("SELECT payload FROM profiles WHERE type = 'club'"),
    ]);
    const expiredTrials = await pool.query(
      "SELECT count(*)::int AS count FROM profiles WHERE is_admin = false AND plan = 'trial' AND trial_started_at < now() - interval '30 days'"
    );
    let pendingPlayerRequests = 0, pendingCoachRequests = 0;
    for (const row of allTeams.rows) {
      pendingPlayerRequests += (row.payload.pending || []).length;
      pendingCoachRequests += (row.payload.coachPending || []).length;
    }
    res.json({
      profileCounts: Object.fromEntries(byType.rows.map((r) => [r.type, r.count])),
      planCounts: Object.fromEntries(byPlan.rows.map((r) => [r.plan, r.count])),
      trialExpiredCount: expiredTrials.rows[0].count,
      postCounts: Object.fromEntries(postsByKind.rows.map((r) => [r.kind, r.count])),
      totalPosts: postsByKind.rows.reduce((sum, r) => sum + r.count, 0),
      liveMatchCounts: Object.fromEntries(liveByStatus.rows.map((r) => [r.status, r.count])),
      accessGrantCounts: Object.fromEntries(grantsByStatus.rows.map((r) => [r.status, r.count])),
      pendingPlayerRequests,
      pendingCoachRequests,
      recentSignups: recent.rows.map((r) => ({ id: r.id, name: r.name, type: r.type, createdAt: r.created_at })),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load admin stats." }); }
});

// ---- join requests (player <-> club) ----

app.post("/api/join-requests", authenticate, async (req, res) => {
  try {
    const playerRow = await requireCallerProfile(req, res, "player");
    if (!playerRow) return;
    const clubRow = await getProfileRow(req.body.clubId);
    if (!clubRow) return res.status(404).json({ error: "Team not found." });

    const player = playerRow.payload;
    const club = clubRow.payload;
    if (!(club.pending || []).includes(player.id)) club.pending = [...(club.pending || []), player.id];
    player.pendingClubId = club.id;

    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [club, club.id]);
    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [player, player.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send join request." }); }
});

app.post("/api/join-requests/respond", authenticate, async (req, res) => {
  try {
    const clubRow = await requireCallerProfile(req, res, "club");
    if (!clubRow) return;
    const { playerId, accept } = req.body;
    const playerRow = await getProfileRow(playerId);
    if (!playerRow) return res.status(404).json({ error: "Player not found." });

    const club = clubRow.payload;
    const player = playerRow.payload;
    club.pending = (club.pending || []).filter((id) => id !== playerId);
    if (accept) club.roster = [...(club.roster || []), playerId];
    player.pendingClubId = null;
    if (accept) player.clubId = club.id;

    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [club, club.id]);
    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [player, playerId]);

    if (accept) {
      const post = { id: uid(), authorId: club.id, authorName: club.name, authorType: "club", kind: "news", title: `${player.name} joined ${club.name}`, body: "", timestamp: new Date().toISOString() };
      await pool.query("INSERT INTO posts (id, author_id, kind, payload) VALUES ($1, $2, $3, $4)", [post.id, post.authorId, post.kind, post]);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not respond to join request." }); }
});

// ---- coach <-> team join requests ----

app.post("/api/coach-join-requests", authenticate, async (req, res) => {
  try {
    const coachRow = await requireCallerProfile(req, res, "coach");
    if (!coachRow) return;
    const teamRow = await getProfileRow(req.body.teamId);
    if (!teamRow) return res.status(404).json({ error: "Team not found." });

    const coach = coachRow.payload;
    const team = teamRow.payload;
    if (!(team.coachPending || []).includes(coach.id)) team.coachPending = [...(team.coachPending || []), coach.id];
    coach.pendingTeamId = team.id;

    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [team, team.id]);
    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [coach, coach.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send coach join request." }); }
});

app.post("/api/coach-join-requests/respond", authenticate, async (req, res) => {
  try {
    const teamRow = await requireCallerProfile(req, res, "club");
    if (!teamRow) return;
    const { coachId, accept } = req.body;
    const coachRow = await getProfileRow(coachId);
    if (!coachRow) return res.status(404).json({ error: "Coach not found." });

    const team = teamRow.payload;
    const coach = coachRow.payload;
    team.coachPending = (team.coachPending || []).filter((id) => id !== coachId);
    if (accept) team.coachRoster = [...(team.coachRoster || []), coachId];
    coach.pendingTeamId = null;
    if (accept) coach.teamId = team.id;

    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [team, team.id]);
    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [coach, coachId]);

    if (accept) {
      const post = { id: uid(), authorId: team.id, authorName: team.name, authorType: "club", kind: "news", title: `${coach.name} joined ${team.name} as coach`, body: "", timestamp: new Date().toISOString() };
      await pool.query("INSERT INTO posts (id, author_id, kind, payload) VALUES ($1, $2, $3, $4)", [post.id, post.authorId, post.kind, post]);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not respond to coach join request." }); }
});

// ---- scout/agent <-> player access grants ----

app.post("/api/access-requests", authenticate, async (req, res) => {
  try {
    const scoutRow = await requireCallerProfile(req, res, "scout");
    if (!scoutRow) return;
    const playerRow = await getProfileRow(req.body.playerId);
    if (!playerRow) return res.status(404).json({ error: "Player not found." });

    await pool.query(
      `INSERT INTO access_grants (id, scout_id, player_id, status) VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (scout_id, player_id) DO UPDATE SET status = 'pending', updated_at = now()`,
      [`grant_${scoutRow.id}_${playerRow.id}`, scoutRow.id, playerRow.id]
    );
    res.status(201).json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send access request." }); }
});

app.post("/api/access-requests/respond", authenticate, async (req, res) => {
  try {
    const playerRow = await requireCallerProfile(req, res, "player");
    if (!playerRow) return;
    const { scoutId, accept } = req.body;
    const status = accept ? "accepted" : "declined";
    await pool.query(`UPDATE access_grants SET status = $1, updated_at = now() WHERE scout_id = $2 AND player_id = $3`, [status, scoutId, playerRow.id]);

    if (accept) {
      const player = playerRow.payload;
      const linked = new Set(player.linkedAgents || []);
      linked.add(scoutId);
      player.linkedAgents = [...linked];
      await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [player, playerRow.id]);
    }
    res.json({ ok: true, status });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not respond to access request." }); }
});

app.get("/api/access-requests/mine", authenticate, async (req, res) => {
  try {
    const me = await getMyProfileRow(req.userId);
    if (!me) return res.json([]);
    const { rows } = await pool.query(`SELECT * FROM access_grants WHERE scout_id = $1 OR player_id = $1 ORDER BY created_at DESC`, [me.id]);
    res.json(rows.map((r) => ({ id: r.id, scoutId: r.scout_id, playerId: r.player_id, status: r.status, createdAt: r.created_at })));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load access requests." }); }
});

// ---- messages (scout <-> player, gated by an accepted access grant) ----

app.get("/api/messages", authenticate, async (req, res) => {
  try {
    const me = await getMyProfileRow(req.userId);
    if (!me) return res.json([]);
    const other = req.query.with;
    const { rows } = await pool.query(
      `SELECT * FROM messages WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1) ORDER BY created_at ASC LIMIT 500`,
      [me.id, other]
    );
    res.json(rows.map((r) => ({ id: r.id, fromId: r.from_id, toId: r.to_id, body: r.body, timestamp: r.created_at })));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load messages." }); }
});

app.post("/api/messages", authenticate, async (req, res) => {
  try {
    const me = await getMyProfileRow(req.userId);
    if (!me) return res.status(404).json({ error: "You don't have a profile yet." });
    const { toId, body } = req.body;
    const grant = await pool.query(
      `SELECT status FROM access_grants WHERE (scout_id = $1 AND player_id = $2) OR (scout_id = $2 AND player_id = $1)`,
      [me.id, toId]
    );
    if (!grant.rows.length || grant.rows[0].status !== "accepted") {
      return res.status(403).json({ error: "Chat is only available once the player has accepted this scout's access request." });
    }
    const id = uid();
    await pool.query("INSERT INTO messages (id, from_id, to_id, body) VALUES ($1, $2, $3, $4)", [id, me.id, toId, body]);
    res.status(201).json({ id, fromId: me.id, toId, body, timestamp: new Date().toISOString() });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send message." }); }
});

// ---- live matches ----

function computeLiveScore(submissions) {
  const counts = {};
  for (const s of submissions) counts[s.score] = (counts[s.score] || 0) + 1;
  let best = null, bestCount = 0;
  for (const [score, count] of Object.entries(counts)) if (count > bestCount) { best = score; bestCount = count; }
  return { liveScore: best, submissionCounts: counts, totalSubmissions: submissions.length };
}

app.get("/api/live-matches", async (req, res) => {
  try {
    const status = req.query.status;
    const { rows } = status
      ? await pool.query("SELECT * FROM live_matches WHERE status = $1 ORDER BY created_at DESC", [status])
      : await pool.query("SELECT * FROM live_matches ORDER BY created_at DESC LIMIT 50");
    res.json(rows.map(rowToLiveMatch));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load live matches." }); }
});

app.post("/api/live-matches", authenticate, async (req, res) => {
  try {
    const clubRow = await requireCallerProfile(req, res, "club");
    if (!clubRow) return;
    const id = uid();
    const payload = { clubName: clubRow.payload.name, opponent: req.body.opponent || "", submissions: [], liveScore: null, submissionCounts: {}, totalSubmissions: 0, startedAt: new Date().toISOString() };
    await pool.query("INSERT INTO live_matches (id, club_id, status, payload) VALUES ($1, $2, 'live', $3)", [id, clubRow.id, payload]);
    res.status(201).json({ ...payload, id, clubId: clubRow.id, status: "live" });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not start live match." }); }
});

app.post("/api/live-matches/:id/score", authenticate, async (req, res) => {
  try {
    const supporterRow = await requireCallerProfile(req, res, "supporter");
    if (!supporterRow) return;
    const { rows } = await pool.query("SELECT * FROM live_matches WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Live match not found." });
    if (rows[0].status !== "live") return res.status(400).json({ error: "This match has already ended." });

    const payload = rows[0].payload;
    const submissions = payload.submissions.filter((s) => s.supporterId !== supporterRow.id);
    submissions.push({ supporterId: supporterRow.id, score: req.body.score, timestamp: new Date().toISOString() });
    const { liveScore, submissionCounts, totalSubmissions } = computeLiveScore(submissions);
    const updated = { ...payload, submissions, liveScore, submissionCounts, totalSubmissions };
    await pool.query("UPDATE live_matches SET payload = $1, updated_at = now() WHERE id = $2", [updated, req.params.id]);
    res.json({ ...updated, id: req.params.id, clubId: rows[0].club_id, status: rows[0].status });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not submit score." }); }
});

app.post("/api/live-matches/:id/end", authenticate, async (req, res) => {
  try {
    const clubRow = await requireCallerProfile(req, res, "club");
    if (!clubRow) return;
    const { rows } = await pool.query("SELECT * FROM live_matches WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Live match not found." });
    if (rows[0].club_id !== clubRow.id) return res.status(403).json({ error: "This isn't your live match." });

    await pool.query("UPDATE live_matches SET status = 'ended', updated_at = now() WHERE id = $1", [req.params.id]);
    const payload = rows[0].payload;
    const post = { id: uid(), authorId: clubRow.id, authorName: clubRow.payload.name, authorType: "club", kind: "matchday", title: `Full time vs ${payload.opponent || "opponents"}`, body: "", meta: { score: payload.liveScore }, timestamp: new Date().toISOString() };
    await pool.query("INSERT INTO posts (id, author_id, kind, payload) VALUES ($1, $2, $3, $4)", [post.id, post.authorId, post.kind, post]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not end live match." }); }
});

// ---- posts ----

app.get("/api/posts", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, payload FROM posts ORDER BY created_at DESC LIMIT 200");
    res.json(rows.map(rowToPost));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load posts." }); }
});

// authorId/authorName/authorType are filled in from the caller's own profile
// server-side, not trusted from the client - so nobody can post as someone else.
app.post("/api/posts", authenticate, async (req, res) => {
  try {
    const row = await requireCallerProfile(req, res);
    if (!row) return;
    const { kind, title, body, meta, imageDataUrl } = req.body;
    const post = {
      id: uid(), authorId: row.id, authorName: row.payload.name, authorType: row.type,
      kind, title, body: body || "", meta: meta || undefined, imageDataUrl: imageDataUrl || undefined,
      timestamp: new Date().toISOString(),
    };
    await pool.query("INSERT INTO posts (id, author_id, kind, payload) VALUES ($1, $2, $3, $4)", [post.id, post.authorId, post.kind, post]);
    res.status(201).json(post);
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not create post." }); }
});

// ---- static frontend ----

const clientDist = path.join(__dirname, "../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = process.env.PORT || 3000;

initSchema()
  .then(() => { app.listen(port, () => console.log(`Pitchside server listening on ${port}`)); })
  .catch((e) => { console.error("Failed to initialize database schema:", e); process.exit(1); });
