const express = require("express");
const cors = require("cors");
const path = require("path");
const { pool, initSchema } = require("./db");

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

const PRICING = { supporter: 25, player: 50, club: 250, scout: 500, coach: 50 };
const TRIAL_DAYS = 30;

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

async function getProfileRow(id) {
  const { rows } = await pool.query("SELECT * FROM profiles WHERE id = $1", [id]);
  return rows[0] || null;
}

function trialExpired(row) {
  if (row.is_admin) return false; // super users never expire and never pay
  if (row.plan !== "trial") return false; // paid plans never expire here
  const daysUsed = (Date.now() - new Date(row.trial_started_at).getTime()) / 86400000;
  return daysUsed > TRIAL_DAYS;
}

// Any action that "creates" something (a post, a join request, a lineup, a live
// match, an access request) is gated behind this so an expired trial can't keep
// generating content. Reading/viewing is never blocked.
async function requireActiveTrialOrPaid(profileId, res) {
  const row = await getProfileRow(profileId);
  if (!row) { res.status(404).json({ error: "Profile not found." }); return null; }
  if (trialExpired(row)) {
    res.status(402).json({
      error: `Your free trial ended. Subscribe for R${PRICING[row.type]}/month to keep using Pitchside.`,
      code: "TRIAL_EXPIRED",
    });
    return null;
  }
  return row;
}

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

app.post("/api/profiles", async (req, res) => {
  try {
    const { profile, ownerToken } = req.body;
    if (!profile?.id || !profile?.type || !profile?.name || !ownerToken) {
      return res.status(400).json({ error: "Missing profile fields." });
    }
    await pool.query(
      `INSERT INTO profiles (id, type, name, owner_token, payload) VALUES ($1, $2, $3, $4, $5)`,
      [profile.id, profile.type, profile.name, ownerToken, profile]
    );
    const row = await getProfileRow(profile.id);
    res.status(201).json(rowToProfile(row));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not create profile." }); }
});

app.put("/api/profiles/:id", async (req, res) => {
  try {
    const { profile, ownerToken } = req.body;
    const row = await getProfileRow(req.params.id);
    if (!row) return res.status(404).json({ error: "Profile not found." });
    if (row.owner_token !== ownerToken) return res.status(403).json({ error: "You don't own this profile." });
    await pool.query(
      `UPDATE profiles SET name = $1, payload = $2, updated_at = now() WHERE id = $3`,
      [profile.name, profile, req.params.id]
    );
    const updated = await getProfileRow(req.params.id);
    res.json(rowToProfile(updated));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not update profile." }); }
});

// Simulated upgrade - no real payment gateway wired up yet, but this is where
// a Stripe/PayFast webhook would eventually flip a profile to plan='paid'.
app.post("/api/profiles/:id/upgrade", async (req, res) => {
  try {
    const { ownerToken } = req.body;
    const row = await getProfileRow(req.params.id);
    if (!row) return res.status(404).json({ error: "Profile not found." });
    if (row.owner_token !== ownerToken) return res.status(403).json({ error: "You don't own this profile." });
    await pool.query(`UPDATE profiles SET plan = 'paid', updated_at = now() WHERE id = $1`, [req.params.id]);
    const updated = await getProfileRow(req.params.id);
    res.json(rowToProfile(updated));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not upgrade profile." }); }
});

// ---- join requests (player <-> club) ----

app.post("/api/join-requests", async (req, res) => {
  const { playerId, playerOwnerToken, clubId } = req.body;
  try {
    const playerRow = await requireActiveTrialOrPaid(playerId, res);
    if (!playerRow) return;
    if (playerRow.owner_token !== playerOwnerToken) return res.status(403).json({ error: "You don't own this player profile." });
    const clubRow = await getProfileRow(clubId);
    if (!clubRow) return res.status(404).json({ error: "Club not found." });

    const player = playerRow.payload;
    const club = clubRow.payload;
    if (!club.pending.includes(playerId)) club.pending = [...club.pending, playerId];
    player.pendingClubId = clubId;

    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [club, clubId]);
    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [player, playerId]);
    res.json({ club: rowToProfile({ ...clubRow, payload: club }), player: rowToProfile({ ...playerRow, payload: player }) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send join request." }); }
});

app.post("/api/join-requests/respond", async (req, res) => {
  const { clubId, clubOwnerToken, playerId, accept } = req.body;
  try {
    const clubRow = await getProfileRow(clubId);
    const playerRow = await getProfileRow(playerId);
    if (!clubRow || !playerRow) return res.status(404).json({ error: "Player or club not found." });
    if (clubRow.owner_token !== clubOwnerToken) return res.status(403).json({ error: "You don't own this club profile." });

    const club = clubRow.payload;
    const player = playerRow.payload;
    club.pending = club.pending.filter((id) => id !== playerId);
    if (accept) club.roster = [...club.roster, playerId];
    player.pendingClubId = null;
    if (accept) player.clubId = clubId;

    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [club, clubId]);
    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [player, playerId]);

    if (accept) {
      const post = {
        id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        authorId: club.id, authorName: club.name, authorType: "club",
        kind: "news", title: `${player.name} joined ${club.name}`, body: "",
        timestamp: new Date().toISOString(),
      };
      await pool.query("INSERT INTO posts (id, author_id, kind, payload) VALUES ($1, $2, $3, $4)", [post.id, post.authorId, post.kind, post]);
    }
    res.json({ club: rowToProfile({ ...clubRow, payload: club }), player: rowToProfile({ ...playerRow, payload: player }) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not respond to join request." }); }
});

// ---- coach <-> team join requests ----

app.post("/api/coach-join-requests", async (req, res) => {
  const { coachId, coachOwnerToken, teamId } = req.body;
  try {
    const coachRow = await requireActiveTrialOrPaid(coachId, res);
    if (!coachRow) return;
    if (coachRow.owner_token !== coachOwnerToken) return res.status(403).json({ error: "You don't own this coach profile." });
    const teamRow = await getProfileRow(teamId);
    if (!teamRow) return res.status(404).json({ error: "Team not found." });

    const coach = coachRow.payload;
    const team = teamRow.payload;
    const coachPending = team.coachPending || [];
    if (!coachPending.includes(coachId)) team.coachPending = [...coachPending, coachId];
    coach.pendingTeamId = teamId;

    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [team, teamId]);
    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [coach, coachId]);
    res.json({ team: rowToProfile({ ...teamRow, payload: team }), coach: rowToProfile({ ...coachRow, payload: coach }) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send coach join request." }); }
});

app.post("/api/coach-join-requests/respond", async (req, res) => {
  const { teamId, teamOwnerToken, coachId, accept } = req.body;
  try {
    const teamRow = await getProfileRow(teamId);
    const coachRow = await getProfileRow(coachId);
    if (!teamRow || !coachRow) return res.status(404).json({ error: "Coach or team not found." });
    if (teamRow.owner_token !== teamOwnerToken) return res.status(403).json({ error: "You don't own this team profile." });

    const team = teamRow.payload;
    const coach = coachRow.payload;
    team.coachPending = (team.coachPending || []).filter((id) => id !== coachId);
    if (accept) team.coachRoster = [...(team.coachRoster || []), coachId];
    coach.pendingTeamId = null;
    if (accept) coach.teamId = teamId;

    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [team, teamId]);
    await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [coach, coachId]);

    if (accept) {
      const post = {
        id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        authorId: team.id, authorName: team.name, authorType: "club",
        kind: "news", title: `${coach.name} joined ${team.name} as coach`, body: "",
        timestamp: new Date().toISOString(),
      };
      await pool.query("INSERT INTO posts (id, author_id, kind, payload) VALUES ($1, $2, $3, $4)", [post.id, post.authorId, post.kind, post]);
    }
    res.json({ team: rowToProfile({ ...teamRow, payload: team }), coach: rowToProfile({ ...coachRow, payload: coach }) });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not respond to coach join request." }); }
});

// ---- scout/agent <-> player access grants ----

app.post("/api/access-requests", async (req, res) => {
  const { scoutId, scoutOwnerToken, playerId } = req.body;
  try {
    const scoutRow = await requireActiveTrialOrPaid(scoutId, res);
    if (!scoutRow) return;
    if (scoutRow.owner_token !== scoutOwnerToken) return res.status(403).json({ error: "You don't own this scout profile." });
    const playerRow = await getProfileRow(playerId);
    if (!playerRow) return res.status(404).json({ error: "Player not found." });

    await pool.query(
      `INSERT INTO access_grants (id, scout_id, player_id, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (scout_id, player_id) DO UPDATE SET status = 'pending', updated_at = now()`,
      [`grant_${scoutId}_${playerId}`, scoutId, playerId]
    );
    res.status(201).json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send access request." }); }
});

app.post("/api/access-requests/respond", async (req, res) => {
  const { playerId, playerOwnerToken, scoutId, accept } = req.body;
  try {
    const playerRow = await getProfileRow(playerId);
    if (!playerRow) return res.status(404).json({ error: "Player not found." });
    if (playerRow.owner_token !== playerOwnerToken) return res.status(403).json({ error: "You don't own this player profile." });

    const status = accept ? "accepted" : "declined";
    await pool.query(
      `UPDATE access_grants SET status = $1, updated_at = now() WHERE scout_id = $2 AND player_id = $3`,
      [status, scoutId, playerId]
    );

    if (accept) {
      const player = playerRow.payload;
      const linked = new Set(player.linkedAgents || []);
      linked.add(scoutId);
      player.linkedAgents = [...linked];
      await pool.query("UPDATE profiles SET payload = $1, updated_at = now() WHERE id = $2", [player, playerId]);
    }
    res.json({ ok: true, status });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not respond to access request." }); }
});

// Grants relevant to a profile: incoming (as player) and outgoing (as scout).
app.get("/api/access-requests/for/:profileId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM access_grants WHERE scout_id = $1 OR player_id = $1 ORDER BY created_at DESC`,
      [req.params.profileId]
    );
    res.json(rows.map((r) => ({
      id: r.id, scoutId: r.scout_id, playerId: r.player_id, status: r.status, createdAt: r.created_at,
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load access requests." }); }
});

// ---- messages (scout <-> player, gated by an accepted access grant) ----

app.get("/api/messages", async (req, res) => {
  const { a, b } = req.query;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM messages WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1) ORDER BY created_at ASC LIMIT 500`,
      [a, b]
    );
    res.json(rows.map((r) => ({ id: r.id, fromId: r.from_id, toId: r.to_id, body: r.body, timestamp: r.created_at })));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not load messages." }); }
});

app.post("/api/messages", async (req, res) => {
  const { fromId, ownerToken, toId, body } = req.body;
  try {
    const fromRow = await getProfileRow(fromId);
    if (!fromRow) return res.status(404).json({ error: "Sender profile not found." });
    if (fromRow.owner_token !== ownerToken) return res.status(403).json({ error: "You don't own this profile." });

    const grant = await pool.query(
      `SELECT status FROM access_grants WHERE (scout_id = $1 AND player_id = $2) OR (scout_id = $2 AND player_id = $1)`,
      [fromId, toId]
    );
    if (!grant.rows.length || grant.rows[0].status !== "accepted") {
      return res.status(403).json({ error: "Chat is only available once the player has accepted this scout's access request." });
    }

    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await pool.query("INSERT INTO messages (id, from_id, to_id, body) VALUES ($1, $2, $3, $4)", [id, fromId, toId, body]);
    res.status(201).json({ id, fromId, toId, body, timestamp: new Date().toISOString() });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not send message." }); }
});

// ---- live matches ----

function computeLiveScore(submissions) {
  const counts = {};
  for (const s of submissions) counts[s.score] = (counts[s.score] || 0) + 1;
  let best = null, bestCount = 0;
  for (const [score, count] of Object.entries(counts)) {
    if (count > bestCount) { best = score; bestCount = count; }
  }
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

app.post("/api/live-matches", async (req, res) => {
  const { clubId, clubOwnerToken, opponent } = req.body;
  try {
    const clubRow = await requireActiveTrialOrPaid(clubId, res);
    if (!clubRow) return;
    if (clubRow.owner_token !== clubOwnerToken) return res.status(403).json({ error: "You don't own this club profile." });

    const id = `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      clubName: clubRow.payload.name, opponent: opponent || "", submissions: [],
      liveScore: null, submissionCounts: {}, totalSubmissions: 0, startedAt: new Date().toISOString(),
    };
    await pool.query("INSERT INTO live_matches (id, club_id, status, payload) VALUES ($1, $2, 'live', $3)", [id, clubId, payload]);
    res.status(201).json({ ...payload, id, clubId, status: "live" });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not start live match." }); }
});

app.post("/api/live-matches/:id/score", async (req, res) => {
  const { supporterId, supporterOwnerToken, score } = req.body;
  try {
    const supporterRow = await requireActiveTrialOrPaid(supporterId, res);
    if (!supporterRow) return;
    if (supporterRow.owner_token !== supporterOwnerToken) return res.status(403).json({ error: "You don't own this supporter profile." });

    const { rows } = await pool.query("SELECT * FROM live_matches WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Live match not found." });
    if (rows[0].status !== "live") return res.status(400).json({ error: "This match has already ended." });

    const payload = rows[0].payload;
    const submissions = payload.submissions.filter((s) => s.supporterId !== supporterId);
    submissions.push({ supporterId, score, timestamp: new Date().toISOString() });
    const { liveScore, submissionCounts, totalSubmissions } = computeLiveScore(submissions);
    const updated = { ...payload, submissions, liveScore, submissionCounts, totalSubmissions };

    await pool.query("UPDATE live_matches SET payload = $1, updated_at = now() WHERE id = $2", [updated, req.params.id]);
    res.json({ ...updated, id: req.params.id, clubId: rows[0].club_id, status: rows[0].status });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not submit score." }); }
});

app.post("/api/live-matches/:id/end", async (req, res) => {
  const { clubOwnerToken } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM live_matches WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Live match not found." });
    const clubRow = await getProfileRow(rows[0].club_id);
    if (!clubRow || clubRow.owner_token !== clubOwnerToken) return res.status(403).json({ error: "You don't own this club profile." });

    await pool.query("UPDATE live_matches SET status = 'ended', updated_at = now() WHERE id = $1", [req.params.id]);

    const payload = rows[0].payload;
    const post = {
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      authorId: clubRow.id, authorName: clubRow.payload.name, authorType: "club",
      kind: "matchday", title: `Full time vs ${payload.opponent || "opponents"}`,
      body: "", meta: { score: payload.liveScore }, timestamp: new Date().toISOString(),
    };
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

app.post("/api/posts", async (req, res) => {
  try {
    const { post, ownerToken } = req.body;
    if (!post?.id || !post?.authorId) return res.status(400).json({ error: "Missing post fields." });
    const row = await requireActiveTrialOrPaid(post.authorId, res);
    if (!row) return;
    if (row.owner_token !== ownerToken) return res.status(403).json({ error: "You don't own this profile." });
    await pool.query("INSERT INTO posts (id, author_id, kind, payload) VALUES ($1, $2, $3, $4)", [post.id, post.authorId, post.kind, post]);
    res.status(201).json(post);
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not create post." }); }
});

// ---- admin / super users ----
// These endpoints are deliberately NOT reachable through the normal onboarding
// flow. Creating an admin requires a server secret (ADMIN_SECRET, set as a
// Railway environment variable, never shipped to the client bundle), so a
// regular visitor can never grant themselves admin access.

app.post("/api/admin/create-profile", async (req, res) => {
  try {
    if (!process.env.ADMIN_SECRET) {
      return res.status(500).json({ error: "ADMIN_SECRET is not configured on the server. Set it in Railway before creating admin accounts." });
    }
    const suppliedSecret = req.get("x-admin-secret");
    if (!suppliedSecret || suppliedSecret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: "Invalid admin secret." });
    }
    const { profile, ownerToken } = req.body;
    if (!profile?.id || !profile?.name || !ownerToken) {
      return res.status(400).json({ error: "Missing profile fields." });
    }
    const adminProfile = { ...profile, type: "admin" };
    await pool.query(
      `INSERT INTO profiles (id, type, name, owner_token, payload, plan, is_admin) VALUES ($1, 'admin', $2, $3, $4, 'paid', true)`,
      [adminProfile.id, adminProfile.name, ownerToken, adminProfile]
    );
    const row = await getProfileRow(adminProfile.id);
    res.status(201).json(rowToProfile(row));
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not create admin profile." }); }
});

async function requireAdmin(profileId, ownerToken, res) {
  const row = await getProfileRow(profileId);
  if (!row) { res.status(404).json({ error: "Profile not found." }); return null; }
  if (row.owner_token !== ownerToken || !row.is_admin) { res.status(403).json({ error: "Admin access required." }); return null; }
  return row;
}

app.get("/api/admin/stats", async (req, res) => {
  const { profileId, ownerToken } = req.query;
  const adminRow = await requireAdmin(profileId, ownerToken, res);
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

// ---- static frontend ----

const clientDist = path.join(__dirname, "../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(port, () => console.log(`Pitchside server listening on ${port}`));
  })
  .catch((e) => {
    console.error("Failed to initialize database schema:", e);
    process.exit(1);
  });
