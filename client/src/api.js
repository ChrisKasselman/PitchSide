const base = "/api";
const TOKEN_KEY = "pitchside:token";

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function req(path, options = {}) {
  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // auth
  register: (email, password) => req("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email, password) => req("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => req("/auth/me"),

  // profiles
  listProfiles: () => req("/profiles"),
  getProfile: (id) => req(`/profiles/${id}`),
  createProfile: (profile) => req("/profiles", { method: "POST", body: JSON.stringify({ profile }) }),
  updateMyProfile: (profile) => req("/profiles/me", { method: "PUT", body: JSON.stringify({ profile }) }),
  upgradeMyProfile: () => req("/profiles/upgrade", { method: "POST" }),

  // player <-> team
  sendJoinRequest: (clubId) => req("/join-requests", { method: "POST", body: JSON.stringify({ clubId }) }),
  respondToJoinRequest: (playerId, accept) => req("/join-requests/respond", { method: "POST", body: JSON.stringify({ playerId, accept }) }),

  // coach <-> team
  sendCoachJoinRequest: (teamId) => req("/coach-join-requests", { method: "POST", body: JSON.stringify({ teamId }) }),
  respondToCoachJoinRequest: (coachId, accept) => req("/coach-join-requests/respond", { method: "POST", body: JSON.stringify({ coachId, accept }) }),

  // scout <-> player
  sendAccessRequest: (playerId) => req("/access-requests", { method: "POST", body: JSON.stringify({ playerId }) }),
  respondAccessRequest: (scoutId, accept) => req("/access-requests/respond", { method: "POST", body: JSON.stringify({ scoutId, accept }) }),
  listMyAccessRequests: () => req("/access-requests/mine"),

  // messages
  listMessages: (withId) => req(`/messages?with=${encodeURIComponent(withId)}`),
  sendMessage: (toId, body) => req("/messages", { method: "POST", body: JSON.stringify({ toId, body }) }),

  // live matches
  listLiveMatches: (status) => req(`/live-matches${status ? `?status=${status}` : ""}`),
  createLiveMatch: (opponent) => req("/live-matches", { method: "POST", body: JSON.stringify({ opponent }) }),
  submitLiveScore: (matchId, score) => req(`/live-matches/${matchId}/score`, { method: "POST", body: JSON.stringify({ score }) }),
  endLiveMatch: (matchId) => req(`/live-matches/${matchId}/end`, { method: "POST" }),

  // posts
  listPosts: () => req("/posts"),
  createPost: (post) => req("/posts", { method: "POST", body: JSON.stringify(post) }),

  // admin
  adminStats: () => req("/admin/stats"),
};
