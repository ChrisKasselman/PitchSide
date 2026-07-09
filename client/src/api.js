const base = "/api";

async function req(path, options) {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  listProfiles: () => req("/profiles"),
  getProfile: (id) => req(`/profiles/${id}`),
  createProfile: (profile, ownerToken) => req("/profiles", { method: "POST", body: JSON.stringify({ profile, ownerToken }) }),
  updateProfile: (id, profile, ownerToken) => req(`/profiles/${id}`, { method: "PUT", body: JSON.stringify({ profile, ownerToken }) }),
  sendJoinRequest: (playerId, playerOwnerToken, clubId) =>
    req("/join-requests", { method: "POST", body: JSON.stringify({ playerId, playerOwnerToken, clubId }) }),
  respondToJoinRequest: (clubId, clubOwnerToken, playerId, accept) =>
    req("/join-requests/respond", { method: "POST", body: JSON.stringify({ clubId, clubOwnerToken, playerId, accept }) }),

  sendCoachJoinRequest: (coachId, coachOwnerToken, teamId) =>
    req("/coach-join-requests", { method: "POST", body: JSON.stringify({ coachId, coachOwnerToken, teamId }) }),
  respondToCoachJoinRequest: (teamId, teamOwnerToken, coachId, accept) =>
    req("/coach-join-requests/respond", { method: "POST", body: JSON.stringify({ teamId, teamOwnerToken, coachId, accept }) }),
  listPosts: () => req("/posts"),
  createPost: (post, ownerToken) => req("/posts", { method: "POST", body: JSON.stringify({ post, ownerToken }) }),
  upgradeProfile: (id, ownerToken) => req(`/profiles/${id}/upgrade`, { method: "POST", body: JSON.stringify({ ownerToken }) }),

  sendAccessRequest: (scoutId, scoutOwnerToken, playerId) =>
    req("/access-requests", { method: "POST", body: JSON.stringify({ scoutId, scoutOwnerToken, playerId }) }),
  respondAccessRequest: (playerId, playerOwnerToken, scoutId, accept) =>
    req("/access-requests/respond", { method: "POST", body: JSON.stringify({ playerId, playerOwnerToken, scoutId, accept }) }),
  listAccessRequestsFor: (profileId) => req(`/access-requests/for/${profileId}`),

  listMessages: (a, b) => req(`/messages?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  sendMessage: (fromId, ownerToken, toId, body) =>
    req("/messages", { method: "POST", body: JSON.stringify({ fromId, ownerToken, toId, body }) }),

  listLiveMatches: (status) => req(`/live-matches${status ? `?status=${status}` : ""}`),
  createLiveMatch: (clubId, clubOwnerToken, opponent) =>
    req("/live-matches", { method: "POST", body: JSON.stringify({ clubId, clubOwnerToken, opponent }) }),
  submitLiveScore: (matchId, supporterId, supporterOwnerToken, score) =>
    req(`/live-matches/${matchId}/score`, { method: "POST", body: JSON.stringify({ supporterId, supporterOwnerToken, score }) }),
  endLiveMatch: (matchId, clubOwnerToken) =>
    req(`/live-matches/${matchId}/end`, { method: "POST", body: JSON.stringify({ clubOwnerToken }) }),

  adminStats: (profileId, ownerToken) =>
    req(`/admin/stats?profileId=${encodeURIComponent(profileId)}&ownerToken=${encodeURIComponent(ownerToken)}`),
};

// ---- device-local identity (this browser's known profiles + their secrets) ----
// This is NOT real authentication - it's a lightweight per-profile secret so that
// only the browser that created a profile can edit it or post as it. Good enough
// for a prototype; swap for real accounts (e.g. email/password or OAuth) later.

const DEVICE_KEY = "pitchside:my-profiles";
const ACTIVE_KEY = "pitchside:active-profile-id";

export function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getMyProfiles() {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY)) || []; } catch { return []; }
}
export function saveMyProfiles(list) {
  localStorage.setItem(DEVICE_KEY, JSON.stringify(list));
}
export function addMyProfile(entry) {
  const list = getMyProfiles();
  saveMyProfiles([...list, entry]);
}
export function getOwnerToken(profileId) {
  const list = getMyProfiles();
  const found = list.find((p) => p.id === profileId);
  return found?.ownerToken || null;
}
export function getActiveProfileId() {
  return localStorage.getItem(ACTIVE_KEY);
}
export function setActiveProfileId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}
export function clearActiveProfile() {
  localStorage.removeItem(ACTIVE_KEY);
}
