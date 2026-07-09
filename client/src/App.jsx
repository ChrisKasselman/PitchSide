import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield, User, Users, Trophy, Camera, Check, X, Plus, ChevronLeft, Newspaper,
  LogOut, Loader2, ImagePlus, Search, MessageCircle, Radio, Briefcase,
} from "lucide-react";
import {
  api, genToken, getMyProfiles, addMyProfile, getOwnerToken,
  getActiveProfileId, setActiveProfileId,
} from "./api.js";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const now = () => new Date().toISOString();
const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " \u00b7 " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
};

async function resizeImage(file, maxW = 640, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const TYPE_META = {
  player: { label: "Player", icon: User, color: "var(--floodlight)" },
  club: { label: "Club / School", icon: Shield, color: "var(--score)" },
  supporter: { label: "Supporter", icon: Users, color: "var(--chalk)" },
  scout: { label: "Scout / Agent", icon: Briefcase, color: "#7FB8E0" },
};

// ---------- shared UI atoms ----------
function TeamSheetCard({ children, style }) {
  return (
    <div style={{ background: "var(--turf-700)", border: "1px solid var(--turf-500)", borderRadius: 10, padding: "18px 20px", position: "relative", ...style }}>
      <div style={{ position: "absolute", left: -1, top: 22, bottom: 22, width: 1, borderLeft: "2px dashed var(--turf-500)" }} />
      {children}
    </div>
  );
}
function JerseyBadge({ number, size = 40 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 8, background: "var(--turf-900)", border: "1px solid var(--floodlight)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--floodlight)", fontSize: size * 0.42, flexShrink: 0 }}>
      {number ?? "-"}
    </div>
  );
}
function Pill({ children, tone = "default" }) {
  const tones = {
    default: { bg: "var(--turf-500)", fg: "var(--chalk)" },
    amber: { bg: "rgba(255,201,77,0.15)", fg: "var(--floodlight)" },
    red: { bg: "rgba(225,72,63,0.18)", fg: "var(--score)" },
    blue: { bg: "rgba(127,184,224,0.16)", fg: "#7FB8E0" },
  };
  const t = tones[tone];
  return <span style={{ background: t.bg, color: t.fg, fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", padding: "3px 9px", borderRadius: 20 }}>{children}</span>;
}
function Btn({ children, onClick, variant = "primary", disabled, style, type = "button" }) {
  const variants = {
    primary: { background: "var(--floodlight)", color: "var(--turf-900)", border: "none" },
    ghost: { background: "transparent", color: "var(--chalk)", border: "1px solid var(--turf-500)" },
    danger: { background: "transparent", color: "var(--score)", border: "1px solid var(--score)" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...variants[variant], fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, letterSpacing: 0.3, padding: "9px 16px", borderRadius: 7, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6, transition: "transform 0.1s", ...style }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >{children}</button>
  );
}
function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "var(--line-grey)", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      {children}
    </label>
  );
}
const inputStyle = { width: "100%", background: "var(--turf-900)", border: "1px solid var(--turf-500)", borderRadius: 6, color: "var(--chalk)", padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-body)", outline: "none", boxSizing: "border-box" };

function TrialBanner({ profile, onUpgrade, busy }) {
  if (profile.plan === "paid") return null;
  const expired = profile.trialDaysLeft <= 0;
  return (
    <div style={{ background: expired ? "rgba(225,72,63,0.15)" : "rgba(255,201,77,0.12)", border: `1px solid ${expired ? "var(--score)" : "var(--floodlight)"}`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ fontSize: 13 }}>
        {expired
          ? `Your free trial has ended. Subscribe for R${profile.monthlyPrice}/month to keep posting, requesting, and publishing.`
          : `Free trial: ${profile.trialDaysLeft} day${profile.trialDaysLeft === 1 ? "" : "s"} left \u00b7 R${profile.monthlyPrice}/month after.`}
      </div>
      <Btn onClick={onUpgrade} disabled={busy} variant={expired ? "primary" : "ghost"}>
        {busy ? <Loader2 size={13} className="spin" /> : expired ? "Subscribe (demo)" : "Upgrade early (demo)"}
      </Btn>
    </div>
  );
}

// ---------- Onboarding ----------
function Onboarding({ onCreated, errorBanner }) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState(null);
  const [form, setForm] = useState({ name: "", position: "", jerseyNumber: "", location: "", level: "club" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const priceFor = { player: 50, club: 250, supporter: 25, scout: 500 };

  const create = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    const profile = {
      id: uid(), type, name: form.name.trim(), createdAt: now(),
      ...(type === "player" ? {
        position: form.position, jerseyNumber: form.jerseyNumber, bio: "", weight: "", height: "", age: "", hobbies: "",
        positions: form.position, career: [], stats: { gamesPlayed: 0, tries: 0, conversions: 0, playerOfMatch: 0 },
        achievements: [], clubId: null, pendingClubId: null, openToOffers: false, currentContract: "", askingSalary: "",
        contactInfo: "", linkedAgents: [],
      } : {}),
      ...(type === "club" ? { location: form.location, level: form.level, roster: [], pending: [], founded: "", trophies: [], currentLog: "" } : {}),
      ...(type === "supporter" ? { bio: "", career: "", supportedClubIds: [] } : {}),
      ...(type === "scout" ? { bio: "", achievements: "" } : {}),
    };
    const ownerToken = genToken();
    try {
      await api.createProfile(profile, ownerToken);
      addMyProfile({ id: profile.id, name: profile.name, type: profile.type, ownerToken });
      setActiveProfileId(profile.id);
      onCreated(profile.id);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 440, margin: "40px auto", padding: "0 16px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 700, letterSpacing: 1, color: "var(--floodlight)" }}>PITCHSIDE</div>
        <div style={{ color: "var(--line-grey)", fontSize: 13, marginTop: 4 }}>Every player, club, supporter and scout on one team sheet.</div>
      </div>

      {errorBanner && <div style={{ background: "rgba(225,72,63,0.15)", color: "var(--score)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{errorBanner}</div>}

      {step === 0 && (
        <TeamSheetCard>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, marginBottom: 14 }}>Choose your profile type</div>
          {Object.entries(TYPE_META).map(([key, meta]) => {
            const Icon = meta.icon;
            return (
              <button key={key} onClick={() => { setType(key); setStep(1); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "var(--turf-900)", border: "1px solid var(--turf-500)", borderRadius: 8, padding: "13px 14px", marginBottom: 10, cursor: "pointer", color: "var(--chalk)", textAlign: "left" }}>
                <Icon size={20} color={meta.color} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{meta.label}</div>
                  <div style={{ fontSize: 12, color: "var(--line-grey)" }}>
                    {key === "player" && "Stats, achievements, join a club"}
                    {key === "club" && "Roster, lineups, live match scoring"}
                    {key === "supporter" && "Follow, share matchday moments"}
                    {key === "scout" && "Track players, chat, see contract status"}
                  </div>
                </div>
              </button>
            );
          })}
        </TeamSheetCard>
      )}

      {step === 1 && (
        <TeamSheetCard>
          <button onClick={() => setStep(0)} style={{ background: "none", border: "none", color: "var(--line-grey)", display: "flex", alignItems: "center", gap: 4, marginBottom: 12, cursor: "pointer", padding: 0, fontSize: 13 }}>
            <ChevronLeft size={14} /> Back
          </button>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, marginBottom: 14 }}>
            {type === "player" && "Set up your player profile"}
            {type === "club" && "Set up your club or school"}
            {type === "supporter" && "Set up your supporter profile"}
            {type === "scout" && "Set up your scout / agent profile"}
          </div>
          <Field label={type === "club" ? "Club / school name" : "Full name"}>
            <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={type === "club" ? "Riverside FC" : "Alex Morgan"} />
          </Field>
          {type === "player" && (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 2 }}><Field label="Position(s)"><input style={inputStyle} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Fly-half, Centre" /></Field></div>
              <div style={{ flex: 1 }}><Field label="Squad no."><input style={inputStyle} type="number" value={form.jerseyNumber} onChange={(e) => setForm({ ...form, jerseyNumber: e.target.value })} placeholder="8" /></Field></div>
            </div>
          )}
          {type === "club" && (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><Field label="Location"><input style={inputStyle} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Johannesburg" /></Field></div>
              <div style={{ flex: 1 }}>
                <Field label="Level">
                  <select style={inputStyle} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
                    <option value="school">School</option><option value="club">Club</option><option value="pro">Professional</option>
                  </select>
                </Field>
              </div>
            </div>
          )}
          {error && <div style={{ color: "var(--score)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
          <Btn onClick={create} disabled={!form.name.trim() || busy} style={{ width: "100%", justifyContent: "center", marginTop: 6 }}>
            {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Create profile
          </Btn>
          <div style={{ fontSize: 11, color: "var(--line-grey)", marginTop: 10, textAlign: "center" }}>30-day free trial, then R{priceFor[type]}/month.</div>
        </TeamSheetCard>
      )}
    </div>
  );
}

// ---------- Chat ----------
function ChatPanel({ meId, meOwnerToken, otherId, otherName, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try { setMessages(await api.listMessages(meId, otherId)); } catch (e) { setError(e.message); }
  }, [meId, otherId]);

  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await api.sendMessage(meId, meOwnerToken, otherId, text.trim()); setText(""); await load(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <TeamSheetCard style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>Chat with {otherName}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--line-grey)", cursor: "pointer" }}><X size={16} /></button>
      </div>
      {error && <div style={{ color: "var(--score)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {messages.length === 0 && <div style={{ color: "var(--line-grey)", fontSize: 13 }}>No messages yet - say hello.</div>}
        {messages.map((m) => (
          <div key={m.id} style={{ alignSelf: m.fromId === meId ? "flex-end" : "flex-start", background: m.fromId === meId ? "var(--floodlight)" : "var(--turf-900)", color: m.fromId === meId ? "var(--turf-900)" : "var(--chalk)", borderRadius: 10, padding: "6px 10px", fontSize: 13, maxWidth: "80%" }}>
            {m.body}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={inputStyle} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" onKeyDown={(e) => e.key === "Enter" && send()} />
        <Btn onClick={send} disabled={busy || !text.trim()}>{busy ? <Loader2 size={13} className="spin" /> : "Send"}</Btn>
      </div>
    </TeamSheetCard>
  );
}

// ---------- Live match ----------
function LiveMatchCard({ match, viewerType, onSubmitScore, onEnd, busy }) {
  const [score, setScore] = useState("");
  const topEntries = Object.entries(match.submissionCounts || {}).sort((a, b) => b[1] - a[1]);
  return (
    <TeamSheetCard style={{ marginBottom: 14, borderColor: "var(--score)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Radio size={14} color="var(--score)" />
        <Pill tone="red">Live</Pill>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{match.clubName} vs {match.opponent || "opponents"}</div>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, color: "var(--floodlight)", fontWeight: 700 }}>{match.liveScore || "-- : --"}</div>
      <div style={{ fontSize: 12, color: "var(--line-grey)", marginBottom: 10 }}>
        {match.totalSubmissions || 0} score submission{match.totalSubmissions === 1 ? "" : "s"} from supporters
        {topEntries.length > 0 && ` \u00b7 ${topEntries.map(([s, c]) => `${s} (${c})`).join(", ")}`}
      </div>
      {viewerType === "supporter" && (
        <div style={{ display: "flex", gap: 8 }}>
          <input style={inputStyle} value={score} onChange={(e) => setScore(e.target.value)} placeholder="What's the score? e.g. 2-1" />
          <Btn onClick={() => { if (score.trim()) { onSubmitScore(match.id, score.trim()); setScore(""); } }} disabled={busy}>{busy ? <Loader2 size={13} className="spin" /> : "Submit"}</Btn>
        </div>
      )}
      {viewerType === "club-owner" && (
        <Btn variant="danger" onClick={() => onEnd(match.id)} disabled={busy}>{busy ? <Loader2 size={13} className="spin" /> : "End match"}</Btn>
      )}
    </TeamSheetCard>
  );
}

// ---------- Player view ----------
function PlayerView({ profile, refresh, clubs }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [achInput, setAchInput] = useState("");
  const [careerDraft, setCareerDraft] = useState({ club: "", from: "", to: "" });
  const [showJoin, setShowJoin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState([]);
  const [chatWith, setChatWith] = useState(null);

  useEffect(() => setDraft(profile), [profile.id]);
  const loadGrants = useCallback(async () => { try { setGrants(await api.listAccessRequestsFor(profile.id)); } catch {} }, [profile.id]);
  useEffect(() => { loadGrants(); }, [loadGrants]);

  const save = async () => {
    setBusy(true);
    try { await api.updateProfile(profile.id, draft, getOwnerToken(profile.id)); setEditing(false); await refresh(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const requestJoin = async (clubId) => {
    setBusy(true);
    try { await api.sendJoinRequest(profile.id, getOwnerToken(profile.id), clubId); setShowJoin(false); await refresh(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const respondScout = async (scoutId, accept) => {
    setBusy(true);
    try { await api.respondAccessRequest(profile.id, getOwnerToken(profile.id), scoutId, accept); await loadGrants(); await refresh(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const upgrade = async () => {
    setBusy(true);
    try { await api.upgradeProfile(profile.id, getOwnerToken(profile.id)); await refresh(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const myClub = profile.clubId ? clubs.find((c) => c.id === profile.clubId) : null;
  const pendingClub = profile.pendingClubId ? clubs.find((c) => c.id === profile.pendingClubId) : null;
  const pendingScouts = grants.filter((g) => g.status === "pending");
  const acceptedScouts = grants.filter((g) => g.status === "accepted");

  return (
    <div>
      <TrialBanner profile={profile} onUpgrade={upgrade} busy={busy} />
      <TeamSheetCard style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <JerseyBadge number={profile.jerseyNumber} size={52} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700 }}>{profile.name}</div>
            <div style={{ color: "var(--line-grey)", fontSize: 13, marginTop: 2 }}>{profile.positions || profile.position || "Position not set"}</div>
            <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {myClub ? <Pill tone="amber">{myClub.name}</Pill> : pendingClub ? <Pill>Request sent \u00b7 {pendingClub.name}</Pill> : <Pill>Unattached</Pill>}
              {profile.openToOffers && <Pill tone="blue">Open to offers</Pill>}
            </div>
          </div>
          <Btn variant="ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Edit"}</Btn>
        </div>

        {editing ? (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--turf-500)", paddingTop: 14 }}>
            <Field label="Bio"><textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} /></Field>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Weight"><input style={inputStyle} value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: e.target.value })} placeholder="82kg" /></Field>
              <Field label="Height"><input style={inputStyle} value={draft.height} onChange={(e) => setDraft({ ...draft, height: e.target.value })} placeholder="1.78m" /></Field>
              <Field label="Age"><input style={inputStyle} value={draft.age} onChange={(e) => setDraft({ ...draft, age: e.target.value })} placeholder="24" /></Field>
            </div>
            <Field label="Position(s)"><input style={inputStyle} value={draft.positions} onChange={(e) => setDraft({ ...draft, positions: e.target.value })} placeholder="Fly-half, Centre" /></Field>
            <Field label="Hobbies"><input style={inputStyle} value={draft.hobbies} onChange={(e) => setDraft({ ...draft, hobbies: e.target.value })} placeholder="Fishing, gym" /></Field>

            <Field label="Career - teams played for">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {draft.career.map((c, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--turf-900)", borderRadius: 6, padding: "6px 10px", fontSize: 13 }}>
                    <span>{c.club} {c.from && `(${c.from}${c.to ? ` - ${c.to}` : " - present"})`}</span>
                    <X size={12} style={{ cursor: "pointer" }} onClick={() => setDraft({ ...draft, career: draft.career.filter((_, idx) => idx !== i) })} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input style={inputStyle} value={careerDraft.club} onChange={(e) => setCareerDraft({ ...careerDraft, club: e.target.value })} placeholder="Club name" />
                <input style={{ ...inputStyle, width: 70 }} value={careerDraft.from} onChange={(e) => setCareerDraft({ ...careerDraft, from: e.target.value })} placeholder="From" />
                <input style={{ ...inputStyle, width: 70 }} value={careerDraft.to} onChange={(e) => setCareerDraft({ ...careerDraft, to: e.target.value })} placeholder="To" />
                <Btn onClick={() => { if (careerDraft.club.trim()) { setDraft({ ...draft, career: [...draft.career, careerDraft] }); setCareerDraft({ club: "", from: "", to: "" }); } }}><Plus size={13} /></Btn>
              </div>
            </Field>

            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Games played"><input type="number" style={inputStyle} value={draft.stats.gamesPlayed} onChange={(e) => setDraft({ ...draft, stats: { ...draft.stats, gamesPlayed: +e.target.value } })} /></Field>
              <Field label="Tries"><input type="number" style={inputStyle} value={draft.stats.tries} onChange={(e) => setDraft({ ...draft, stats: { ...draft.stats, tries: +e.target.value } })} /></Field>
              <Field label="Conversions"><input type="number" style={inputStyle} value={draft.stats.conversions} onChange={(e) => setDraft({ ...draft, stats: { ...draft.stats, conversions: +e.target.value } })} /></Field>
              <Field label="POTM"><input type="number" style={inputStyle} value={draft.stats.playerOfMatch} onChange={(e) => setDraft({ ...draft, stats: { ...draft.stats, playerOfMatch: +e.target.value } })} /></Field>
            </div>
            <div style={{ fontSize: 11, color: "var(--line-grey)", marginTop: -8, marginBottom: 14 }}>Stats show as club-approved once your club confirms them for the season.</div>

            <Field label="Add achievement">
              <div style={{ display: "flex", gap: 8 }}>
                <input style={inputStyle} value={achInput} onChange={(e) => setAchInput(e.target.value)} placeholder="Golden Boot 2025" />
                <Btn onClick={() => { if (achInput.trim()) { setDraft({ ...draft, achievements: [...draft.achievements, achInput.trim()] }); setAchInput(""); } }}><Plus size={14} /></Btn>
              </div>
            </Field>
            {draft.achievements.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                {draft.achievements.map((a, i) => (
                  <Pill key={i} tone="amber">{a} <X size={11} style={{ marginLeft: 5, cursor: "pointer", verticalAlign: -1 }} onClick={() => setDraft({ ...draft, achievements: draft.achievements.filter((_, idx) => idx !== i) })} /></Pill>
                ))}
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--turf-500)", paddingTop: 14, marginTop: 4 }}>
              <div style={{ fontSize: 12, color: "var(--line-grey)", textTransform: "uppercase", marginBottom: 10 }}>Contract & scouting (visible to accepted scouts/agents only)</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13 }}>
                <input type="checkbox" checked={draft.openToOffers} onChange={(e) => setDraft({ ...draft, openToOffers: e.target.checked })} /> Open to offers
              </label>
              <Field label="Current contract"><input style={inputStyle} value={draft.currentContract} onChange={(e) => setDraft({ ...draft, currentContract: e.target.value })} placeholder="Contracted until Dec 2027" /></Field>
              <Field label="Asking salary"><input style={inputStyle} value={draft.askingSalary} onChange={(e) => setDraft({ ...draft, askingSalary: e.target.value })} placeholder="R25,000/month" /></Field>
              <Field label="Contact details"><input style={inputStyle} value={draft.contactInfo} onChange={(e) => setDraft({ ...draft, contactInfo: e.target.value })} placeholder="email or phone number" /></Field>
            </div>

            <Btn onClick={save} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : "Save changes"}</Btn>
          </div>
        ) : (
          <>
            {profile.bio && <div style={{ marginTop: 14, fontSize: 14, color: "var(--chalk)" }}>{profile.bio}</div>}
            <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "var(--line-grey)", flexWrap: "wrap" }}>
              {profile.weight && <span>{profile.weight}</span>}
              {profile.height && <span>{profile.height}</span>}
              {profile.age && <span>{profile.age} yrs</span>}
              {profile.hobbies && <span>Hobbies: {profile.hobbies}</span>}
            </div>
            <div style={{ display: "flex", gap: 24, marginTop: 16, borderTop: "1px solid var(--turf-500)", paddingTop: 14, flexWrap: "wrap" }}>
              {[["Games", profile.stats.gamesPlayed], ["Tries", profile.stats.tries], ["Conv.", profile.stats.conversions], ["POTM", profile.stats.playerOfMatch]].map(([label, val]) => (
                <div key={label}><div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 700, color: "var(--floodlight)" }}>{val}</div><div style={{ fontSize: 11, color: "var(--line-grey)", textTransform: "uppercase" }}>{label}</div></div>
              ))}
            </div>
            {profile.career?.length > 0 && (
              <div style={{ marginTop: 14, fontSize: 13 }}>
                <div style={{ fontSize: 11, color: "var(--line-grey)", textTransform: "uppercase", marginBottom: 6 }}>Career</div>
                {profile.career.map((c, i) => <div key={i} style={{ color: "var(--chalk)" }}>{c.club} {c.from && `(${c.from}${c.to ? ` - ${c.to}` : " - present"})`}</div>)}
              </div>
            )}
            {profile.achievements.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {profile.achievements.map((a, i) => <Pill key={i} tone="amber"><Trophy size={10} style={{ verticalAlign: -1, marginRight: 4 }} />{a}</Pill>)}
              </div>
            )}
          </>
        )}
      </TeamSheetCard>

      {!myClub && !pendingClub && (
        <TeamSheetCard style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600 }}>Join a club</div>
            <Btn variant="ghost" onClick={() => setShowJoin((v) => !v)}>{showJoin ? "Close" : "Browse clubs"}</Btn>
          </div>
          {showJoin && (
            <div style={{ marginTop: 12 }}>
              {clubs.length === 0 && <div style={{ color: "var(--line-grey)", fontSize: 13 }}>No clubs on Pitchside yet.</div>}
              {clubs.map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderTop: "1px solid var(--turf-500)" }}>
                  <div><div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div><div style={{ fontSize: 12, color: "var(--line-grey)" }}>{c.location} \u00b7 {c.level}</div></div>
                  <Btn onClick={() => requestJoin(c.id)} disabled={busy}>Request</Btn>
                </div>
              ))}
            </div>
          )}
        </TeamSheetCard>
      )}
      {pendingClub && (
        <TeamSheetCard style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "var(--line-grey)" }}>Waiting for <strong style={{ color: "var(--chalk)" }}>{pendingClub.name}</strong> to accept your request.</div>
        </TeamSheetCard>
      )}

      <TeamSheetCard>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, marginBottom: 10 }}>Scouts & agents</div>
        {pendingScouts.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "var(--line-grey)", textTransform: "uppercase", marginBottom: 8 }}>Requesting access</div>
            {pendingScouts.map((g) => (
              <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: "1px solid var(--turf-500)" }}>
                <div style={{ fontSize: 13 }}>Scout <code>{g.scoutId}</code></div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn onClick={() => respondScout(g.scoutId, true)} disabled={busy}><Check size={13} /></Btn>
                  <Btn variant="danger" onClick={() => respondScout(g.scoutId, false)} disabled={busy}><X size={13} /></Btn>
                </div>
              </div>
            ))}
          </div>
        )}
        {acceptedScouts.length === 0 && pendingScouts.length === 0 && <div style={{ fontSize: 13, color: "var(--line-grey)" }}>No scouts have requested access yet.</div>}
        {acceptedScouts.map((g) => (
          <div key={g.id} style={{ padding: "7px 0", borderTop: "1px solid var(--turf-500)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13 }}>Linked agent <code>{g.scoutId}</code></div>
              <Btn variant="ghost" onClick={() => setChatWith(chatWith === g.scoutId ? null : g.scoutId)}><MessageCircle size={13} /> Message</Btn>
            </div>
            {chatWith === g.scoutId && <ChatPanel meId={profile.id} meOwnerToken={getOwnerToken(profile.id)} otherId={g.scoutId} otherName="agent" onClose={() => setChatWith(null)} />}
          </div>
        ))}
      </TeamSheetCard>
    </div>
  );
}

// ---------- Club view ----------
function ClubView({ profile, refresh, allProfiles, onPost }) {
  const [tab, setTab] = useState("roster");
  const [lineupName, setLineupName] = useState("");
  const [opponent, setOpponent] = useState("");
  const [selected, setSelected] = useState([]);
  const [newsText, setNewsText] = useState("");
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bioDraft, setBioDraft] = useState({ founded: profile.founded || "", currentLog: profile.currentLog || "" });
  const [trophyInput, setTrophyInput] = useState("");
  const [trophies, setTrophies] = useState(profile.trophies || []);
  const [savingBio, setSavingBio] = useState(false);
  const [liveMatch, setLiveMatch] = useState(null);
  const [matchOpponent, setMatchOpponent] = useState("");

  const rosterPlayers = profile.roster.map((id) => allProfiles.find((p) => p.id === id)).filter(Boolean);
  const pendingPlayers = profile.pending.map((id) => allProfiles.find((p) => p.id === id)).filter(Boolean);

  const loadLive = useCallback(async () => {
    try { const all = await api.listLiveMatches("live"); setLiveMatch(all.find((m) => m.clubId === profile.id) || null); } catch {}
  }, [profile.id]);
  useEffect(() => { loadLive(); }, [loadLive]);

  const respond = async (playerId, accept) => {
    setBusy(true);
    try { await api.respondToJoinRequest(profile.id, getOwnerToken(profile.id), playerId, accept); await refresh(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const toggleSelect = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const postLineup = async () => {
    setPosting(true);
    const lineup = selected.map((id) => { const p = rosterPlayers.find((r) => r.id === id); return { id, name: p.name, number: p.jerseyNumber, position: p.positions || p.position }; });
    try {
      await onPost({ kind: "lineup", authorId: profile.id, authorName: profile.name, authorType: "club", title: lineupName || "Matchday lineup", body: opponent ? `vs ${opponent}` : "", meta: { lineup } });
      setLineupName(""); setOpponent(""); setSelected([]); setTab("roster");
    } catch (e) { alert(e.message); }
    setPosting(false);
  };

  const postNews = async () => {
    if (!newsText.trim()) return;
    setPosting(true);
    try { await onPost({ kind: "news", authorId: profile.id, authorName: profile.name, authorType: "club", title: newsText.trim(), body: "" }); setNewsText(""); }
    catch (e) { alert(e.message); }
    setPosting(false);
  };

  const saveBio = async () => {
    setSavingBio(true);
    try { await api.updateProfile(profile.id, { ...profile, ...bioDraft, trophies }, getOwnerToken(profile.id)); await refresh(); }
    catch (e) { alert(e.message); }
    setSavingBio(false);
  };

  const startLiveMatch = async () => {
    setBusy(true);
    try { await api.createLiveMatch(profile.id, getOwnerToken(profile.id), matchOpponent); setMatchOpponent(""); await loadLive(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const endLiveMatch = async (id) => {
    setBusy(true);
    try { await api.endLiveMatch(id, getOwnerToken(profile.id)); await loadLive(); await refresh(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const upgrade = async () => { setBusy(true); try { await api.upgradeProfile(profile.id, getOwnerToken(profile.id)); await refresh(); } catch (e) { alert(e.message); } setBusy(false); };

  return (
    <div>
      <TrialBanner profile={profile} onUpgrade={upgrade} busy={busy} />
      <TeamSheetCard style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 52, height: 52, borderRadius: 8, background: "var(--turf-900)", border: "1px solid var(--score)", display: "flex", alignItems: "center", justifyContent: "center" }}><Shield size={26} color="var(--score)" /></div>
          <div><div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700 }}>{profile.name}</div><div style={{ color: "var(--line-grey)", fontSize: 13 }}>{profile.location} \u00b7 {profile.level}{profile.founded && ` \u00b7 Est. ${profile.founded}`}</div></div>
        </div>
        {profile.trophies?.length > 0 && <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>{profile.trophies.map((t, i) => <Pill key={i} tone="amber"><Trophy size={10} style={{ verticalAlign: -1, marginRight: 4 }} />{t}</Pill>)}</div>}
        {profile.currentLog && <div style={{ marginTop: 10, fontSize: 13, color: "var(--chalk)", whiteSpace: "pre-wrap" }}>{profile.currentLog}</div>}
        <div style={{ display: "flex", gap: 24, marginTop: 16, borderTop: "1px solid var(--turf-500)", paddingTop: 14 }}>
          <div><div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 700, color: "var(--floodlight)" }}>{profile.roster.length}</div><div style={{ fontSize: 11, color: "var(--line-grey)", textTransform: "uppercase" }}>Squad</div></div>
          {profile.pending.length > 0 && <div><div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 700, color: "var(--score)" }}>{profile.pending.length}</div><div style={{ fontSize: 11, color: "var(--line-grey)", textTransform: "uppercase" }}>Pending</div></div>}
        </div>
      </TeamSheetCard>

      {liveMatch && <LiveMatchCard match={liveMatch} viewerType="club-owner" onEnd={endLiveMatch} busy={busy} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {["roster", "lineup", "news", "live match", "club info"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "var(--floodlight)" : "transparent", color: tab === t ? "var(--turf-900)" : "var(--chalk)", border: "1px solid var(--turf-500)", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>
            {t}{t === "roster" && profile.pending.length > 0 ? ` (${profile.pending.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "roster" && (
        <TeamSheetCard>
          {pendingPlayers.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--line-grey)", textTransform: "uppercase", marginBottom: 8 }}>Join requests</div>
              {pendingPlayers.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--turf-500)" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}><JerseyBadge number={p.jerseyNumber} size={32} /><div><div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div><div style={{ fontSize: 12, color: "var(--line-grey)" }}>{p.positions || p.position}</div></div></div>
                  <div style={{ display: "flex", gap: 6 }}><Btn onClick={() => respond(p.id, true)} disabled={busy}><Check size={14} /></Btn><Btn variant="danger" onClick={() => respond(p.id, false)} disabled={busy}><X size={14} /></Btn></div>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--line-grey)", textTransform: "uppercase", marginBottom: 8 }}>Squad</div>
          {rosterPlayers.length === 0 && <div style={{ fontSize: 13, color: "var(--line-grey)" }}>No players yet.</div>}
          {rosterPlayers.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--turf-500)" }}>
              <JerseyBadge number={p.jerseyNumber} size={32} />
              <div><div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div><div style={{ fontSize: 12, color: "var(--line-grey)" }}>{p.positions || p.position} \u00b7 {p.stats.tries}T {p.stats.conversions}C</div></div>
            </div>
          ))}
        </TeamSheetCard>
      )}

      {tab === "lineup" && (
        <TeamSheetCard>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Match title"><input style={inputStyle} value={lineupName} onChange={(e) => setLineupName(e.target.value)} placeholder="League Round 12" /></Field>
            <Field label="Opponent"><input style={inputStyle} value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="Northside United" /></Field>
          </div>
          <div style={{ fontSize: 12, color: "var(--line-grey)", textTransform: "uppercase", margin: "10px 0 8px" }}>Select starting lineup ({selected.length})</div>
          {rosterPlayers.length === 0 && <div style={{ fontSize: 13, color: "var(--line-grey)" }}>Add players to your squad first.</div>}
          {rosterPlayers.map((p) => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--turf-500)", cursor: "pointer" }}>
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggleSelect(p.id)} />
              <JerseyBadge number={p.jerseyNumber} size={28} />
              <div style={{ fontSize: 14 }}>{p.name} <span style={{ color: "var(--line-grey)" }}>\u00b7 {p.positions || p.position}</span></div>
            </label>
          ))}
          <Btn onClick={postLineup} disabled={selected.length === 0 || posting} style={{ marginTop: 14 }}>{posting ? <Loader2 size={14} className="spin" /> : <Newspaper size={14} />} Publish lineup</Btn>
        </TeamSheetCard>
      )}

      {tab === "news" && (
        <TeamSheetCard>
          <Field label="Club news or announcement"><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={newsText} onChange={(e) => setNewsText(e.target.value)} placeholder="Training moved to Thursday 6pm this week." /></Field>
          <Btn onClick={postNews} disabled={!newsText.trim() || posting}>{posting ? <Loader2 size={14} className="spin" /> : <Newspaper size={14} />} Post</Btn>
        </TeamSheetCard>
      )}

      {tab === "live match" && (
        <TeamSheetCard>
          {liveMatch ? (
            <div style={{ fontSize: 13, color: "var(--line-grey)" }}>A match is already live above. End it before starting a new one.</div>
          ) : (
            <>
              <Field label="Opponent"><input style={inputStyle} value={matchOpponent} onChange={(e) => setMatchOpponent(e.target.value)} placeholder="Northside United" /></Field>
              <Btn onClick={startLiveMatch} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Radio size={14} />} Go live</Btn>
              <div style={{ fontSize: 12, color: "var(--line-grey)", marginTop: 10 }}>Once live, supporters can submit scores from the app. The most-submitted score shows as the live score.</div>
            </>
          )}
        </TeamSheetCard>
      )}

      {tab === "club info" && (
        <TeamSheetCard>
          <Field label="Founded"><input style={inputStyle} value={bioDraft.founded} onChange={(e) => setBioDraft({ ...bioDraft, founded: e.target.value })} placeholder="1998" /></Field>
          <Field label="Current log / standing"><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={bioDraft.currentLog} onChange={(e) => setBioDraft({ ...bioDraft, currentLog: e.target.value })} placeholder={"1. Riverside FC - 24pts\n2. Northside United - 21pts"} /></Field>
          <Field label="Add a trophy">
            <div style={{ display: "flex", gap: 8 }}>
              <input style={inputStyle} value={trophyInput} onChange={(e) => setTrophyInput(e.target.value)} placeholder="League Champions 2024" />
              <Btn onClick={() => { if (trophyInput.trim()) { setTrophies([...trophies, trophyInput.trim()]); setTrophyInput(""); } }}><Plus size={14} /></Btn>
            </div>
          </Field>
          {trophies.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>{trophies.map((t, i) => <Pill key={i} tone="amber">{t} <X size={11} style={{ marginLeft: 5, cursor: "pointer", verticalAlign: -1 }} onClick={() => setTrophies(trophies.filter((_, idx) => idx !== i))} /></Pill>)}</div>}
          <Btn onClick={saveBio} disabled={savingBio}>{savingBio ? <Loader2 size={14} className="spin" /> : "Save club info"}</Btn>
        </TeamSheetCard>
      )}
    </div>
  );
}

// ---------- Supporter view ----------
function SupporterProfileCard({ profile, refresh, clubs }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ bio: profile.bio || "", career: profile.career || "", supportedClubIds: profile.supportedClubIds || [] });
  const [busy, setBusy] = useState(false);

  const toggleClub = (id) => setDraft((d) => ({ ...d, supportedClubIds: d.supportedClubIds.includes(id) ? d.supportedClubIds.filter((x) => x !== id) : [...d.supportedClubIds, id] }));

  const save = async () => {
    setBusy(true);
    try { await api.updateProfile(profile.id, { ...profile, ...draft }, getOwnerToken(profile.id)); setEditing(false); await refresh(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const upgrade = async () => { setBusy(true); try { await api.upgradeProfile(profile.id, getOwnerToken(profile.id)); await refresh(); } catch (e) { alert(e.message); } setBusy(false); };

  return (
    <>
      <TrialBanner profile={profile} onUpgrade={upgrade} busy={busy} />
      <TeamSheetCard style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700 }}>{profile.name}</div>
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(profile.supportedClubIds || []).map((id) => { const c = clubs.find((x) => x.id === id); return c ? <Pill key={id} tone="amber">{c.name}</Pill> : null; })}
              {(!profile.supportedClubIds || profile.supportedClubIds.length === 0) && <Pill>Not following a club yet</Pill>}
            </div>
          </div>
          <Btn variant="ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Edit"}</Btn>
        </div>
        {editing ? (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--turf-500)", paddingTop: 14 }}>
            <Field label="Bio"><textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} /></Field>
            <Field label="Your supporter story"><textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} value={draft.career} onChange={(e) => setDraft({ ...draft, career: e.target.value })} placeholder="Been following Riverside since 2015..." /></Field>
            <Field label="Teams you support">
              {clubs.length === 0 && <div style={{ fontSize: 13, color: "var(--line-grey)" }}>No clubs on Pitchside yet.</div>}
              {clubs.map((c) => (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 0" }}>
                  <input type="checkbox" checked={draft.supportedClubIds.includes(c.id)} onChange={() => toggleClub(c.id)} /> {c.name}
                </label>
              ))}
            </Field>
            <Btn onClick={save} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : "Save changes"}</Btn>
          </div>
        ) : (
          <>
            {profile.bio && <div style={{ marginTop: 14, fontSize: 14 }}>{profile.bio}</div>}
            {profile.career && <div style={{ marginTop: 8, fontSize: 13, color: "var(--line-grey)" }}>{profile.career}</div>}
          </>
        )}
      </TeamSheetCard>
    </>
  );
}

function SupporterUpload({ profile, onPost }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [score, setScore] = useState("");
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (e) => { const f = e.target.files[0]; if (!f) return; setImage(await resizeImage(f)); };

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onPost({ kind: "matchday", authorId: profile.id, authorName: profile.name, authorType: "supporter", title: title.trim(), body, meta: { score: score || null }, imageDataUrl: image });
      setTitle(""); setBody(""); setScore(""); setImage(null);
    } catch (e) { alert(e.message); }
    setBusy(false);
  };

  return (
    <TeamSheetCard style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, marginBottom: 12 }}>Share from the game</div>
      <Field label="What's happening"><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Riverside FC 2 - 1 Northside" /></Field>
      <Field label="Score (optional)"><input style={inputStyle} value={score} onChange={(e) => setScore(e.target.value)} placeholder="2-1" /></Field>
      <Field label="Notes (optional)"><textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What a second half." /></Field>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        <Btn variant="ghost" onClick={() => fileRef.current.click()}><Camera size={14} /> {image ? "Change photo" : "Add photo"}</Btn>
        {image && <img src={image} alt="" style={{ height: 40, borderRadius: 5 }} />}
      </div>
      <Btn onClick={submit} disabled={!title.trim() || busy}>{busy ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />} Post</Btn>
    </TeamSheetCard>
  );
}

// ---------- Scout view ----------
function ScoutView({ profile, refresh, allProfiles }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ bio: profile.bio || "", achievements: profile.achievements || "" });
  const [busy, setBusy] = useState(false);
  const [grants, setGrants] = useState([]);
  const [query, setQuery] = useState("");
  const [chatWith, setChatWith] = useState(null);

  const players = allProfiles.filter((p) => p.type === "player");
  const filtered = players.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  const loadGrants = useCallback(async () => { try { setGrants(await api.listAccessRequestsFor(profile.id)); } catch {} }, [profile.id]);
  useEffect(() => { loadGrants(); }, [loadGrants]);

  const statusFor = (playerId) => grants.find((g) => g.playerId === playerId)?.status || null;

  const requestAccess = async (playerId) => {
    setBusy(true);
    try { await api.sendAccessRequest(profile.id, getOwnerToken(profile.id), playerId); await loadGrants(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    try { await api.updateProfile(profile.id, { ...profile, ...draft }, getOwnerToken(profile.id)); setEditing(false); await refresh(); }
    catch (e) { alert(e.message); }
    setBusy(false);
  };
  const upgrade = async () => { setBusy(true); try { await api.upgradeProfile(profile.id, getOwnerToken(profile.id)); await refresh(); } catch (e) { alert(e.message); } setBusy(false); };

  const accepted = grants.filter((g) => g.status === "accepted").map((g) => players.find((p) => p.id === g.playerId)).filter(Boolean);

  return (
    <div>
      <TrialBanner profile={profile} onUpgrade={upgrade} busy={busy} />
      <TeamSheetCard style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div><div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700 }}>{profile.name}</div><Pill tone="blue">{accepted.length} player{accepted.length === 1 ? "" : "s"} on profile</Pill></div>
          <Btn variant="ghost" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Edit"}</Btn>
        </div>
        {editing ? (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--turf-500)", paddingTop: 14 }}>
            <Field label="Bio"><textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} /></Field>
            <Field label="Achievements"><textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical" }} value={draft.achievements} onChange={(e) => setDraft({ ...draft, achievements: e.target.value })} placeholder="Placed 6 players in professional contracts since 2020" /></Field>
            <Btn onClick={save} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : "Save changes"}</Btn>
          </div>
        ) : (
          <>
            {profile.bio && <div style={{ marginTop: 14, fontSize: 14 }}>{profile.bio}</div>}
            {profile.achievements && <div style={{ marginTop: 8, fontSize: 13, color: "var(--line-grey)" }}>{profile.achievements}</div>}
          </>
        )}
      </TeamSheetCard>

      <TeamSheetCard style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, marginBottom: 10 }}>Your players</div>
        {accepted.length === 0 && <div style={{ fontSize: 13, color: "var(--line-grey)" }}>No accepted players yet - find and request access below.</div>}
        {accepted.map((p) => (
          <div key={p.id} style={{ padding: "10px 0", borderTop: "1px solid var(--turf-500)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}><JerseyBadge number={p.jerseyNumber} size={32} /><div><div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div><div style={{ fontSize: 12, color: "var(--line-grey)" }}>{p.positions || p.position}</div></div></div>
              <Btn variant="ghost" onClick={() => setChatWith(chatWith === p.id ? null : p.id)}><MessageCircle size={13} /> Message</Btn>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {p.openToOffers && <Pill tone="blue">Open to offers</Pill>}
              {p.currentContract && <Pill>Contract: {p.currentContract}</Pill>}
              {p.askingSalary && <Pill tone="amber">Asking: {p.askingSalary}</Pill>}
              {p.linkedAgents?.length > 1 && <Pill>{p.linkedAgents.length} agents linked</Pill>}
            </div>
            {p.contactInfo && <div style={{ fontSize: 12, color: "var(--line-grey)", marginTop: 6 }}>Contact: {p.contactInfo}</div>}
            {chatWith === p.id && <ChatPanel meId={profile.id} meOwnerToken={getOwnerToken(profile.id)} otherId={p.id} otherName={p.name} onClose={() => setChatWith(null)} />}
          </div>
        ))}
      </TeamSheetCard>

      <TeamSheetCard>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, marginBottom: 10 }}>Find players</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, background: "var(--turf-900)", border: "1px solid var(--turf-500)", borderRadius: 6, padding: "6px 10px" }}>
          <Search size={14} color="var(--line-grey)" />
          <input style={{ ...inputStyle, border: "none", padding: 0, background: "transparent" }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search players by name" />
        </div>
        {filtered.length === 0 && <div style={{ fontSize: 13, color: "var(--line-grey)" }}>No players found.</div>}
        {filtered.map((p) => {
          const status = statusFor(p.id);
          return (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--turf-500)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}><JerseyBadge number={p.jerseyNumber} size={28} /><div style={{ fontSize: 14 }}>{p.name} <span style={{ color: "var(--line-grey)" }}>\u00b7 {p.positions || p.position}</span></div></div>
              {status === "accepted" ? <Pill tone="amber">Linked</Pill> : status === "pending" ? <Pill>Requested</Pill> : <Btn onClick={() => requestAccess(p.id)} disabled={busy}>Request access</Btn>}
            </div>
          );
        })}
      </TeamSheetCard>
    </div>
  );
}

// ---------- Feed ----------
function PostCard({ post }) {
  const meta = TYPE_META[post.authorType] || TYPE_META.supporter;
  return (
    <TeamSheetCard style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <meta.icon size={15} color={meta.color} />
          <div style={{ fontWeight: 600, fontSize: 13 }}>{post.authorName}</div>
          {post.kind === "lineup" && <Pill tone="amber">Lineup</Pill>}
          {post.kind === "matchday" && <Pill tone="red">Matchday</Pill>}
          {post.kind === "news" && <Pill>News</Pill>}
        </div>
        <div style={{ fontSize: 11, color: "var(--line-grey)" }}>{fmtDate(post.timestamp)}</div>
      </div>
      <div style={{ marginTop: 10, fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>{post.title}</div>
      {post.body && <div style={{ fontSize: 13.5, color: "var(--chalk)", marginTop: 4 }}>{post.body}</div>}
      {post.meta?.score && <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--floodlight)", marginTop: 6 }}>{post.meta.score}</div>}
      {post.imageDataUrl && <img src={post.imageDataUrl} alt="" style={{ width: "100%", borderRadius: 6, marginTop: 10, display: "block" }} />}
      {post.meta?.lineup && (
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {post.meta.lineup.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", background: "var(--turf-900)", borderRadius: 6, padding: "6px 8px" }}>
              <JerseyBadge number={p.number} size={26} /><div style={{ fontSize: 12.5 }}>{p.name}<div style={{ color: "var(--line-grey)", fontSize: 11 }}>{p.position}</div></div>
            </div>
          ))}
        </div>
      )}
    </TeamSheetCard>
  );
}

// ---------- App ----------
export default function App() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [myProfiles, setMyProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeProfile, setActiveProfile] = useState(null);
  const [allProfiles, setAllProfiles] = useState([]);
  const [posts, setPosts] = useState([]);
  const [liveMatches, setLiveMatches] = useState([]);
  const [nav, setNav] = useState("profile");
  const [switching, setSwitching] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);

  const bootstrap = useCallback(async () => {
    setLoadError(null);
    try {
      const mine = getMyProfiles();
      const active = getActiveProfileId();
      const [profiles, allPosts, live] = await Promise.all([api.listProfiles(), api.listPosts(), api.listLiveMatches("live")]);
      setMyProfiles(mine);
      setAllProfiles(profiles);
      setPosts(allPosts);
      setLiveMatches(live);
      if (active) { setActiveId(active); setActiveProfile(profiles.find((p) => p.id === active) || null); }
    } catch (e) { setLoadError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const refresh = useCallback(async () => {
    const profiles = await api.listProfiles();
    setAllProfiles(profiles);
    if (activeId) setActiveProfile(profiles.find((p) => p.id === activeId) || null);
  }, [activeId]);

  const refreshPosts = useCallback(async () => { setPosts(await api.listPosts()); }, []);
  const refreshLive = useCallback(async () => { setLiveMatches(await api.listLiveMatches("live")); }, []);

  const handleCreated = async (id) => {
    setMyProfiles(getMyProfiles());
    setActiveId(id);
    const profiles = await api.listProfiles();
    setAllProfiles(profiles);
    setActiveProfile(profiles.find((p) => p.id === id) || null);
    setNav("profile");
  };

  const switchProfile = async (id) => { setActiveProfileId(id); setActiveId(id); setSwitching(false); await refresh(); setNav("profile"); };

  const makePost = async (partial) => {
    const post = { id: uid(), timestamp: now(), ...partial };
    await api.createPost(post, getOwnerToken(partial.authorId));
    await refreshPosts();
  };

  const submitLiveScore = async (matchId, score) => {
    setLiveBusy(true);
    try { await api.submitLiveScore(matchId, activeProfile.id, getOwnerToken(activeProfile.id), score); await refreshLive(); }
    catch (e) { alert(e.message); }
    setLiveBusy(false);
  };

  if (loading) return <div style={rootStyle}><Shell><div style={{ textAlign: "center", padding: 60, color: "var(--line-grey)" }}><Loader2 className="spin" size={22} /></div></Shell></div>;
  if (loadError) return <div style={rootStyle}><Shell><Onboarding onCreated={handleCreated} errorBanner={`Could not reach the server: ${loadError}`} /></Shell></div>;
  if (!activeProfile) return <div style={rootStyle}><Shell><Onboarding onCreated={handleCreated} /></Shell></div>;

  const clubs = allProfiles.filter((p) => p.type === "club");

  return (
    <div style={rootStyle}>
      <Shell>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, letterSpacing: 0.5, color: "var(--floodlight)" }}>PITCHSIDE</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {["profile", "feed"].map((n) => (
                <button key={n} onClick={() => setNav(n)} style={{ background: nav === n ? "var(--turf-500)" : "transparent", border: "1px solid var(--turf-500)", color: "var(--chalk)", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", textTransform: "capitalize" }}>{n === "profile" ? "My profile" : "Feed"}</button>
              ))}
            </div>
            <button onClick={() => setSwitching((v) => !v)} title="Switch profile" style={{ background: "transparent", border: "1px solid var(--turf-500)", borderRadius: 20, padding: "6px 10px", color: "var(--chalk)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
              <LogOut size={13} /> {activeProfile.name}
            </button>
            {switching && (
              <div style={{ position: "absolute", top: 38, right: 0, background: "var(--turf-700)", border: "1px solid var(--turf-500)", borderRadius: 8, padding: 8, zIndex: 10, minWidth: 200 }}>
                {myProfiles.map((p) => (
                  <button key={p.id} onClick={() => switchProfile(p.id)} style={{ display: "block", width: "100%", textAlign: "left", background: p.id === activeId ? "var(--turf-500)" : "transparent", border: "none", color: "var(--chalk)", padding: "7px 9px", borderRadius: 5, cursor: "pointer", fontSize: 13 }}>{p.name} <span style={{ color: "var(--line-grey)" }}>\u00b7 {TYPE_META[p.type].label}</span></button>
                ))}
                <button onClick={() => { setSwitching(false); setActiveProfile(null); setActiveId(null); }} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderTop: "1px solid var(--turf-500)", marginTop: 6, color: "var(--floodlight)", padding: "7px 9px", cursor: "pointer", fontSize: 13 }}><Plus size={12} style={{ verticalAlign: -1, marginRight: 4 }} />New profile</button>
              </div>
            )}
          </div>
        </div>

        {nav === "profile" && activeProfile.type === "player" && <PlayerView profile={activeProfile} refresh={refresh} clubs={clubs} />}
        {nav === "profile" && activeProfile.type === "club" && <ClubView profile={activeProfile} refresh={refresh} allProfiles={allProfiles} onPost={makePost} />}
        {nav === "profile" && activeProfile.type === "scout" && <ScoutView profile={activeProfile} refresh={refresh} allProfiles={allProfiles} />}
        {nav === "profile" && activeProfile.type === "supporter" && (
          <div>
            <SupporterProfileCard profile={activeProfile} refresh={refresh} clubs={clubs} />
            {liveMatches.map((m) => <LiveMatchCard key={m.id} match={m} viewerType="supporter" onSubmitScore={submitLiveScore} busy={liveBusy} />)}
            <SupporterUpload profile={activeProfile} onPost={makePost} />
            {posts.length === 0 && <div style={{ color: "var(--line-grey)", fontSize: 13, textAlign: "center", padding: 20 }}>No posts yet. Yours could be the first.</div>}
            {posts.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
        )}
        {nav === "feed" && (
          <div>
            {liveMatches.map((m) => <LiveMatchCard key={m.id} match={m} viewerType={activeProfile.type === "supporter" ? "supporter" : "viewer"} onSubmitScore={submitLiveScore} busy={liveBusy} />)}
            {posts.length === 0 && <div style={{ color: "var(--line-grey)", fontSize: 13, textAlign: "center", padding: 20 }}>Nothing on the feed yet. Post a lineup, achievement, or matchday update to get started.</div>}
            {posts.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
        )}
      </Shell>
    </div>
  );
}

function Shell({ children }) {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@600;700&display=swap');
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        input:focus, textarea:focus, select:focus { border-color: var(--floodlight) !important; }
        ::placeholder { color: var(--line-grey); opacity: 0.7; }
        body { margin: 0; }
        code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; font-family: var(--font-mono); font-size: 11px; }
      `}</style>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px 60px" }}>{children}</div>
    </>
  );
}

const rootStyle = {
  "--turf-900": "#0C2E22", "--turf-700": "#163F2E", "--turf-500": "#4C7C63",
  "--chalk": "#F3EFE4", "--floodlight": "#FFC94D", "--score": "#E1483F", "--line-grey": "#9BB0A3",
  "--font-display": "'Rajdhani', sans-serif", "--font-body": "'Inter', sans-serif", "--font-mono": "'JetBrains Mono', monospace",
  background: "var(--turf-900)", color: "var(--chalk)", fontFamily: "var(--font-body)", minHeight: "100vh",
};
