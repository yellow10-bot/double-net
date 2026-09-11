import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./lib/supabaseClient";
import { containsBadContent } from "./lib/filter";
import { uploadImage } from "./lib/uploadImage";

// ---------- small helpers ----------
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function isLocked(user) {
  if (!user) return false;
  if (user.is_admin) return false;
  if (user.locked_permanent) return true;
  if (user.locked_until && Date.now() < new Date(user.locked_until).getTime()) return true;
  return false;
}
function lockLabel(user) {
  if (user.locked_permanent) return "Locked";
  if (user.locked_until) return `Locked until ${fmtDate(user.locked_until)}`;
  return "";
}

const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Australia", "Ireland", "New Zealand",
  "Germany", "France", "Spain", "Italy", "Portugal", "Netherlands", "Belgium", "Switzerland",
  "Austria", "Sweden", "Norway", "Denmark", "Finland", "Poland", "Greece", "Turkey",
  "Mexico", "Brazil", "Argentina", "Chile", "Colombia", "Peru",
  "Japan", "South Korea", "China", "India", "Indonesia", "Philippines", "Vietnam", "Thailand",
  "Singapore", "Malaysia", "Pakistan", "Bangladesh",
  "South Africa", "Nigeria", "Egypt", "Kenya", "Morocco",
  "Israel", "Saudi Arabia", "United Arab Emirates",
  "Russia", "Ukraine", "Other",
];

const DEFAULT_SETTINGS = { site_name: "Double.net", tagline: "Updates from the top, conversation from everyone verified.", banner_url: null, banner_position_y: 50 };

function Avatar({ user, size = "md" }) {
  const initial = (user?.username || "?").slice(0, 1).toUpperCase();
  return (
    <div className={`ch-avatar ${size}`}>
      {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : initial}
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [me, setMe] = useState(null); // my profile row, or null if logged out
  const [profiles, setProfiles] = useState([]); // everyone, for People/lookups
  const [officialPosts, setOfficialPosts] = useState([]);
  const [forums, setForums] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [view, setView] = useState("home");
  const [activeForumId, setActiveForumId] = useState(null);
  const [activeForumMessages, setActiveForumMessages] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activityTarget, setActivityTarget] = useState(null);
  const [activityItems, setActivityItems] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [personId, setPersonId] = useState(null);
  const [flags, setFlags] = useState([]);

  const profileById = (id) => profiles.find((p) => p.id === id) || null;

  async function loadMe(userId) {
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (data && !isLocked(data)) {
      setMe(data);
    } else if (data && isLocked(data)) {
      await supabase.auth.signOut();
      setMe(null);
    }
  }

  async function loadAll() {
    const [{ data: settingsRow }, { data: forumsRows }, { data: postsRows }, { data: profileRows }, { count: adminCount }] =
      await Promise.all([
        supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
        supabase.from("forums").select("*").order("created_at"),
        supabase
          .from("official_posts")
          .select("*, author:profiles(username, avatar_url)")
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("*").order("username"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true),
      ]);
    if (settingsRow) setSettings(settingsRow);
    setForums(forumsRows || []);
    setOfficialPosts(postsRows || []);
    setProfiles(profileRows || []);
    setNeedsSetup(!adminCount);
  }

  useEffect(() => {
    (async () => {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession?.user) await loadMe(authSession.user.id);
      await loadAll();
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession?.user) loadMe(newSession.user.id);
      else setMe(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadForumMessages(forumId) {
    const { data } = await supabase
      .from("messages")
      .select("*, author:profiles(id, username, avatar_url, is_admin, verified)")
      .eq("forum_id", forumId)
      .order("created_at");
    setActiveForumMessages(data || []);
  }

  function openForum(forumId) {
    setActiveForumId(forumId);
    setView("forum");
    loadForumMessages(forumId);
  }

  async function logout() {
    await supabase.auth.signOut();
    setMe(null);
    setView("home");
  }

  async function refreshProfiles() {
    const { data } = await supabase.from("profiles").select("*").order("username");
    setProfiles(data || []);
  }

  async function reportFlag({ authorId, room, text }) {
    await supabase.from("flags").insert({ author_id: authorId, room, text });
    if (me?.is_admin) refreshFlags();
  }

  async function refreshFlags() {
    const { data } = await supabase
      .from("flags")
      .select("*, author:profiles(username)")
      .order("created_at", { ascending: false });
    setFlags(data || []);
  }

  async function dismissFlag(flagId) {
    await supabase.from("flags").delete().eq("id", flagId);
    setFlags((f) => f.filter((x) => x.id !== flagId));
  }

  async function lockUser(userId, days) {
    if (days === "forever") {
      await supabase.from("profiles").update({ locked_permanent: true, locked_until: null }).eq("id", userId);
    } else {
      const until = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("profiles").update({ locked_permanent: false, locked_until: until }).eq("id", userId);
    }
    refreshProfiles();
  }
  async function unlockUser(userId) {
    await supabase.from("profiles").update({ locked_permanent: false, locked_until: null }).eq("id", userId);
    refreshProfiles();
  }

  async function openActivity(userId) {
    const person = profileById(userId);
    setActivityTarget(person?.username || "");
    setView("activity");
    setActivityLoading(true);
    const [{ data: posts }, { data: msgs }] = await Promise.all([
      supabase.from("official_posts").select("*").eq("author_id", userId),
      supabase.from("messages").select("*, forum:forums(name)").eq("author_id", userId),
    ]);
    const items = [
      ...(posts || []).map((p) => ({ room: "Home", date: p.created_at, body: `${p.title} — ${p.body}`, image: p.image_url })),
      ...(msgs || []).map((m) => ({ room: m.forum?.name || "Chat", date: m.created_at, body: m.body, image: m.image_url })),
    ];
    items.sort((a, b) => new Date(b.date) - new Date(a.date));
    setActivityItems(items);
    setActivityLoading(false);
  }

  async function resolveLoginEmail(identifier) {
    if (identifier.includes("@")) return identifier;
    const { data } = await supabase.from("profiles").select("email").ilike("username", identifier).maybeSingle();
    return data?.email || null;
  }

  if (!ready) {
    return (
      <div className="ch-root">
        <div className="ch-shell"><div className="ch-loading">Loading…</div></div>
      </div>
    );
  }

  const headerContent = (
    <>
      <div>
        <h1 className="ch-title ch-serif">{settings.site_name}</h1>
        <p className="ch-tagline">{settings.tagline}</p>
      </div>
      {me ? (
        <div className="ch-user">
          <span>{me.username}</span>
          {me.is_admin && <span className="ch-badge gold">Creator</span>}
          {!me.is_admin && me.verified && <span className="ch-badge moss">Verified</span>}
          {!me.is_admin && !me.verified && <span className="ch-badge plain">Pending</span>}
          <button className="ch-btn text" onClick={logout}>Log out</button>
        </div>
      ) : (
        <div className="ch-user">
          <button className="ch-btn text" onClick={() => { setError(""); setView("login"); }}>Log in</button>
          <button className="ch-btn solid" onClick={() => { setError(""); setView(needsSetup ? "setup" : "signup"); }}>
            {needsSetup ? "Set up account" : "Sign up"}
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="ch-root">
      {settings.banner_url && (
        <div className="ch-banner-wrap">
          <img src={settings.banner_url} alt="" style={{ objectPosition: `center ${settings.banner_position_y ?? 50}%` }} />
          <div className="ch-banner-overlay" />
          <div className="ch-banner-header">{headerContent}</div>
        </div>
      )}
      <div className="ch-shell">
        {!settings.banner_url && <div className="ch-header">{headerContent}</div>}

        <div className="ch-tabs">
          <button className={`ch-tab ${view === "home" ? "active" : ""}`} onClick={() => setView("home")}>Home</button>
          <button className={`ch-tab ${view === "forums" || view === "forum" ? "active" : ""}`} onClick={() => setView("forums")}>Chats</button>
          <button className={`ch-tab ${view === "people" ? "active" : ""}`} onClick={() => setView("people")}>People</button>
          {me && <button className={`ch-tab ${view === "profile" ? "active" : ""}`} onClick={() => setView("profile")}>Profile</button>}
        </div>

        {view === "home" && (
          <HomeView
            me={me}
            posts={officialPosts}
            onPost={async ({ title, body, imageFile }) => {
              let image_url = null;
              if (imageFile) image_url = await uploadImage(imageFile, "posts");
              await supabase.from("official_posts").insert({ author_id: me.id, title, body, image_url });
              const { data } = await supabase.from("official_posts").select("*, author:profiles(username, avatar_url)").order("created_at", { ascending: false });
              setOfficialPosts(data || []);
            }}
            onDelete={async (postId) => {
              await supabase.from("official_posts").delete().eq("id", postId);
              setOfficialPosts((p) => p.filter((x) => x.id !== postId));
            }}
            onTogglePin={async (post) => {
              await supabase.from("official_posts").update({ pinned: !post.pinned }).eq("id", post.id);
              setOfficialPosts((p) => p.map((x) => (x.id === post.id ? { ...x, pinned: !x.pinned } : x)));
            }}
          />
        )}

        {view === "forums" && (
          <ForumsView
            me={me}
            forums={forums}
            onOpen={openForum}
            onCreate={async ({ name, description }) => {
              const { data } = await supabase.from("forums").insert({ name, description }).select().single();
              if (data) setForums((f) => [...f, data]);
            }}
            onDelete={async (forumId) => {
              await supabase.from("forums").delete().eq("id", forumId);
              setForums((f) => f.filter((x) => x.id !== forumId));
            }}
          />
        )}

        {view === "forum" && activeForumId && (
          <ChatRoomView
            forum={forums.find((f) => f.id === activeForumId)}
            me={me}
            messages={activeForumMessages}
            onBack={() => setView("forums")}
            onSend={async (text, imageFile) => {
              let image_url = null;
              if (imageFile) image_url = await uploadImage(imageFile, `messages/${activeForumId}`);
              await supabase.from("messages").insert({ forum_id: activeForumId, author_id: me.id, body: text, image_url });
              loadForumMessages(activeForumId);
            }}
            onFlag={(text) => {
              const forum = forums.find((f) => f.id === activeForumId);
              reportFlag({ authorId: me.id, room: forum?.name || "Chat", text });
            }}
          />
        )}

        {view === "people" && (
          <PeopleView
            profiles={profiles}
            me={me}
            onOpen={(id) => { setPersonId(id); setView("person"); }}
          />
        )}

        {view === "person" && personId && profileById(personId) && (
          <PersonProfileView
            user={profileById(personId)}
            viewer={me}
            onBack={() => setView("people")}
            onViewActivity={() => openActivity(personId)}
            onVerify={async () => { await supabase.from("profiles").update({ verified: true }).eq("id", personId); refreshProfiles(); }}
            onUnverify={async () => { await supabase.from("profiles").update({ verified: false }).eq("id", personId); refreshProfiles(); }}
            onPromote={async () => { await supabase.from("profiles").update({ is_admin: true, verified: true }).eq("id", personId); refreshProfiles(); }}
            onRemove={async () => { await supabase.from("profiles").delete().eq("id", personId); await refreshProfiles(); setView("people"); }}
            onLock={(days) => lockUser(personId, days)}
            onUnlock={() => unlockUser(personId)}
          />
        )}

        {view === "activity" && me?.is_admin && (
          <ActivityView target={activityTarget} items={activityItems} loading={activityLoading} onBack={() => setView("people")} />
        )}

        {view === "profile" && me && (
          <ProfileView
            me={me}
            onSaveProfile={async ({ avatarFile, country, bio, currentAvatarUrl }) => {
              let avatar_url = currentAvatarUrl;
              if (avatarFile) avatar_url = await uploadImage(avatarFile, `avatars/${me.id}`);
              await supabase.from("profiles").update({ avatar_url, country, bio }).eq("id", me.id);
              setMe((m) => ({ ...m, avatar_url, country, bio }));
              refreshProfiles();
            }}
            onRenameUsername={async (newUsername) => {
              const trimmed = newUsername.trim();
              if (!trimmed) return { ok: false, message: "Username can't be empty." };
              if (trimmed.toLowerCase() === me.username.toLowerCase()) return { ok: true };
              const { data: existing } = await supabase.from("profiles").select("id").ilike("username", trimmed).maybeSingle();
              if (existing) return { ok: false, message: "That username is taken." };
              const { error: updateError } = await supabase.from("profiles").update({ username: trimmed }).eq("id", me.id);
              if (updateError) return { ok: false, message: "Couldn't save — try again." };
              setMe((m) => ({ ...m, username: trimmed }));
              refreshProfiles();
              return { ok: true };
            }}
          />
        )}

        {(view === "login" || view === "signup" || view === "setup") && (
          <AuthView
            mode={view}
            error={error}
            setError={setError}
            busy={busy}
            onSetup={async ({ username, email, password }) => {
              setBusy(true);
              const { data: existing } = await supabase.from("profiles").select("id").ilike("username", username.trim()).maybeSingle();
              if (existing) { setError("That username is taken."); setBusy(false); return; }
              const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
              if (signUpError) { setError(signUpError.message); setBusy(false); return; }
              if (!signUpData.session) { setError("Check your email to confirm your account, then log in."); setBusy(false); return; }
              await supabase.from("profiles").insert({
                id: signUpData.user.id, username: username.trim(), email: email.trim(), is_admin: true, verified: true,
              });
              await loadMe(signUpData.user.id);
              await loadAll();
              setBusy(false);
              setView("home");
            }}
            onSignup={async ({ username, email, password, confirm }) => {
              if (password !== confirm) { setError("Passwords don't match."); return; }
              setBusy(true);
              const { data: existing } = await supabase.from("profiles").select("id").ilike("username", username.trim()).maybeSingle();
              if (existing) { setError("That username is taken."); setBusy(false); return; }
              const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email: email.trim(), password });
              if (signUpError) {
                setError(signUpError.message.includes("registered") ? "An account with that email already exists — log in instead." : signUpError.message);
                setBusy(false);
                return;
              }
              if (!signUpData.session) { setError("Check your email to confirm your account, then log in."); setBusy(false); return; }
              await supabase.from("profiles").insert({
                id: signUpData.user.id, username: username.trim(), email: email.trim(), is_admin: false, verified: false,
              });
              await loadMe(signUpData.user.id);
              await refreshProfiles();
              setBusy(false);
              setView("home");
            }}
            onLogin={async ({ identifier, password }) => {
              setBusy(true);
              const email = await resolveLoginEmail(identifier.trim());
              if (!email) { setError("No account found with that username or email."); setBusy(false); return; }
              const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
              setBusy(false);
              if (signInError) { setError("Incorrect username/email or password."); return; }
              const { data: profile } = await supabase.from("profiles").select("*").eq("id", signInData.user.id).maybeSingle();
              if (profile && isLocked(profile)) {
                await supabase.auth.signOut();
                setError(profile.locked_permanent ? "This account has been locked." : `This account is locked until ${fmtDate(profile.locked_until)}.`);
                return;
              }
              setMe(profile);
              setView("home");
            }}
          />
        )}

        {view === "admin" && me?.is_admin && (
          <AdminView
            profiles={profiles}
            settings={settings}
            onBack={() => setView("home")}
            onSaveSettings={async ({ site_name, tagline, bannerFile, removeBanner, banner_position_y }) => {
              let banner_url = settings.banner_url;
              if (removeBanner) banner_url = null;
              if (bannerFile) banner_url = await uploadImage(bannerFile, "banner");
              const next = { site_name, tagline, banner_url, banner_position_y };
              await supabase.from("settings").update(next).eq("id", 1);
              setSettings((s) => ({ ...s, ...next }));
            }}
            onVerify={async (id) => { await supabase.from("profiles").update({ verified: true }).eq("id", id); refreshProfiles(); }}
            onRemove={async (id) => { await supabase.from("profiles").delete().eq("id", id); refreshProfiles(); }}
            onLock={lockUser}
            onUnlock={unlockUser}
            flags={flags}
            onLoadFlags={refreshFlags}
            onDismissFlag={dismissFlag}
            onLockByUsername={(username, days) => {
              const person = profiles.find((p) => p.username === username);
              if (person) lockUser(person.id, days);
            }}
          />
        )}
      </div>

      {me?.is_admin && view !== "admin" && (
        <button className="ch-controls-btn" onClick={() => setView("admin")}>⚙ Controls</button>
      )}
    </div>
  );
}

function DangerButton({ label = "Delete", small, onConfirm }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button className={`ch-btn danger ${small ? "small" : ""}`} onClick={() => setConfirming(true)}>{label}</button>;
  }
  return (
    <span style={{ display: "flex", gap: 6 }}>
      <button className={`ch-btn solid danger ${small ? "small" : ""}`} onClick={onConfirm}>Confirm</button>
      <button className={`ch-btn text ${small ? "small" : ""}`} onClick={() => setConfirming(false)}>Cancel</button>
    </span>
  );
}

function LockControl({ user, onLock, onUnlock }) {
  const [days, setDays] = useState("7");
  if (user.is_admin) return null;
  if (isLocked(user)) {
    return (
      <>
        <span className="ch-badge danger">{lockLabel(user)}</span>
        <button className="ch-btn small" onClick={onUnlock}>Unlock</button>
      </>
    );
  }
  return (
    <>
      <select className="ch-select-inline" value={days} onChange={(e) => setDays(e.target.value)}>
        <option value="1">1 day</option>
        <option value="3">3 days</option>
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="forever">Indefinitely</option>
      </select>
      <button className="ch-btn small" onClick={() => onLock(days)}>Lock</button>
    </>
  );
}

// image is a *preview* (object URL or existing remote URL). The actual file
// is handed back via onFile so the parent can upload it only when saving.
function ImagePicker({ image, onFile, onClear, compact }) {
  const fileRef = useRef();
  const [preview, setPreview] = useState(image || null);
  const [err, setErr] = useState("");

  function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    setPreview(URL.createObjectURL(file));
    onFile(file);
  }

  return (
    <div>
      {preview && !compact && (
        <div className="ch-image-preview">
          <img src={preview} alt="" />
          <button type="button" onClick={() => { setPreview(null); onClear && onClear(); }}>×</button>
        </div>
      )}
      <input type="file" accept="image/*" ref={fileRef} style={{ display: "none" }} onChange={handleFile} />
      {err && <div className="ch-error">{err}</div>}
      {compact ? (
        <button type="button" className="ch-icon-btn" title="Add photo" onClick={() => fileRef.current.click()}>📷</button>
      ) : (
        <button type="button" className="ch-btn small" onClick={() => fileRef.current.click()}>{preview ? "Change photo" : "Add photo"}</button>
      )}
    </div>
  );
}

function ProfileView({ me, onSaveProfile, onRenameUsername }) {
  const [avatarFile, setAvatarFile] = useState(null);
  const [country, setCountry] = useState(me.country || "");
  const [bio, setBio] = useState(me.bio || "");
  const [savedFlash, setSavedFlash] = useState(false);
  const [username, setUsername] = useState(me.username);
  const [usernameError, setUsernameError] = useState("");
  const [usernameSaved, setUsernameSaved] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <div>
      <div className="ch-profile-head">
        <Avatar user={me} size="lg" />
        <div>
          <h2 className="ch-serif" style={{ margin: "0 0 4px 0" }}>{me.username}</h2>
          <div className="ch-note" style={{ margin: 0 }}>{me.email}</div>
        </div>
      </div>

      <div className="ch-card" style={{ marginBottom: 20 }}>
        <span className="ch-label">Username</span>
        {usernameError && <div className="ch-error">{usernameError}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <input className="ch-field" style={{ marginBottom: 0 }} value={username} onChange={(e) => { setUsername(e.target.value); setUsernameError(""); setUsernameSaved(false); }} />
          <button
            className="ch-btn solid"
            disabled={renaming || !username.trim() || username.trim() === me.username}
            onClick={async () => {
              setRenaming(true);
              setUsernameError("");
              const res = await onRenameUsername(username);
              setRenaming(false);
              if (!res.ok) setUsernameError(res.message);
              else { setUsernameSaved(true); setTimeout(() => setUsernameSaved(false), 1500); }
            }}
          >
            {usernameSaved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      <div className="ch-card">
        <span className="ch-label">Profile photo</span>
        <div style={{ marginBottom: 18 }}>
          <ImagePicker image={me.avatar_url} onFile={setAvatarFile} onClear={() => setAvatarFile(null)} />
        </div>

        <span className="ch-label">Country</span>
        <select className="ch-field" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Prefer not to say</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <span className="ch-label">Bio</span>
        <textarea className="ch-field" rows={4} placeholder="Tell people a bit about yourself…" value={bio} onChange={(e) => setBio(e.target.value)} />

        <button
          className="ch-btn solid"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSaveProfile({ avatarFile, country, bio, currentAvatarUrl: me.avatar_url });
            setSaving(false);
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 1500);
          }}
        >
          {savedFlash ? "Saved" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

function PersonProfileView({ user, viewer, onBack, onViewActivity, onVerify, onUnverify, onPromote, onRemove, onLock, onUnlock }) {
  const isAdmin = viewer?.is_admin;
  const isSelf = viewer && viewer.id === user.id;

  return (
    <div>
      <button className="ch-back" onClick={onBack}>← People</button>

      <div className="ch-profile-head">
        <Avatar user={user} size="lg" />
        <div>
          <h2 className="ch-serif" style={{ margin: "0 0 4px 0" }}>{user.username}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {user.is_admin && <span className="ch-badge gold">Creator</span>}
            {!user.is_admin && user.verified && <span className="ch-badge moss">Verified</span>}
            {!user.is_admin && !user.verified && <span className="ch-badge plain">Pending</span>}
            {isAdmin && isLocked(user) && <span className="ch-badge danger">{lockLabel(user)}</span>}
          </div>
        </div>
      </div>

      <div className="ch-card">
        {user.country && <div className="ch-note" style={{ margin: "0 0 12px 0" }}>📍 {user.country}</div>}
        <span className="ch-label">Bio</span>
        {user.bio && user.bio.trim() ? (
          <p style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{user.bio}</p>
        ) : (
          <p style={{ color: "var(--ink-soft)", fontStyle: "italic" }}>Didn't have time to write a bio.</p>
        )}
        <div className="ch-note" style={{ marginTop: 14, marginBottom: 0 }}>Joined {fmtDate(user.created_at)}</div>
      </div>

      {isAdmin && !isSelf && (
        <>
          <p className="ch-sub">Admin tools</p>
          <div className="ch-card">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: user.is_admin ? 0 : 14 }}>
              <button className="ch-btn small" onClick={onViewActivity}>View everything they've posted</button>
              {!user.is_admin && (
                <>
                  {user.verified ? (
                    <button className="ch-btn small" onClick={onUnverify}>Revoke verification</button>
                  ) : (
                    <button className="ch-btn small" onClick={onVerify}>Verify</button>
                  )}
                  <button className="ch-btn small" onClick={onPromote}>Make admin</button>
                </>
              )}
            </div>
            {!user.is_admin && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <LockControl user={user} onLock={onLock} onUnlock={onUnlock} />
                <DangerButton small label="Remove account" onConfirm={onRemove} />
              </div>
            )}
            {user.is_admin && <p className="ch-note" style={{ margin: 0 }}>Creator accounts can't be locked or removed.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function HomeView({ me, posts, onPost, onDelete, onTogglePin }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [posting, setPosting] = useState(false);

  const sorted = [...posts].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));

  return (
    <div>
      {me?.is_admin && (
        <div className="ch-compose">
          <input className="ch-field" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="ch-field" rows={3} placeholder="What's the update?" value={body} onChange={(e) => setBody(e.target.value)} />
          <div style={{ marginBottom: 14 }}>
            <ImagePicker image={null} onFile={setImageFile} onClear={() => setImageFile(null)} />
          </div>
          <button
            className="ch-btn solid"
            disabled={posting || !title.trim() || !body.trim()}
            onClick={async () => {
              setPosting(true);
              await onPost({ title: title.trim(), body: body.trim(), imageFile });
              setTitle(""); setBody(""); setImageFile(null);
              setPosting(false);
            }}
          >
            Publish
          </button>
        </div>
      )}

      <div className="ch-message-panel">
        {sorted.length === 0 && <p className="ch-empty">No updates posted yet.</p>}
        {sorted.map((p) => (
          <div className="ch-post-item" key={p.id}>
            {p.pinned && <div className="ch-pin">Pinned</div>}
            <h3 className="ch-serif">{p.title}</h3>
            <div className="ch-meta">{fmtDate(p.created_at)} · {p.author?.username}</div>
            <p>{p.body}</p>
            {p.image_url && <img src={p.image_url} alt="" />}
            {me?.is_admin && (
              <div className="ch-card-actions">
                <button className="ch-btn small" onClick={() => onTogglePin(p)}>{p.pinned ? "Unpin" : "Pin"}</button>
                <DangerButton small onConfirm={() => onDelete(p.id)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ForumsView({ me, forums, onOpen, onCreate, onDelete }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        {me?.is_admin && (
          <button className="ch-btn" onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Cancel" : "New chat room"}</button>
        )}
      </div>

      {showCreate && (
        <div className="ch-compose">
          <input className="ch-field" placeholder="Room name (e.g. Support)" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="ch-field" rows={2} placeholder="What's this room about?" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button
            className="ch-btn solid"
            disabled={!name.trim()}
            onClick={async () => { await onCreate({ name: name.trim(), description: desc.trim() }); setName(""); setDesc(""); setShowCreate(false); }}
          >
            Create room
          </button>
        </div>
      )}

      {!me?.verified && !me?.is_admin && (
        <p className="ch-note">{me ? "Your account is awaiting verification before you can chat — you can still browse." : "Log in or sign up to chat — anyone can browse."}</p>
      )}

      {forums.length === 0 && <p className="ch-empty">No chat rooms yet.</p>}
      {forums.map((f) => (
        <div className="ch-forum-card" key={f.id}>
          <div onClick={() => onOpen(f.id)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar user={{ username: f.name }} size="md" />
            <div>
              <h3 className="ch-serif">{f.name}</h3>
              <p>{f.description}</p>
            </div>
          </div>
          {me?.is_admin && (
            <div onClick={(e) => e.stopPropagation()}>
              <DangerButton small onConfirm={() => onDelete(f.id)} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ChatBar({ canPost, disabledText, placeholder, onSend, onBadContent }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [warning, setWarning] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!warning) return;
    const t = setTimeout(() => setWarning(false), 4000);
    return () => clearTimeout(t);
  }, [warning]);

  if (!canPost) return <p className="ch-note" style={{ marginTop: 20 }}>{disabledText}</p>;

  if (!open) {
    return <button className="ch-chat-pill" onClick={() => setOpen(true)}>{placeholder}</button>;
  }

  async function send() {
    if (!text.trim() && !imageFile) return;
    if (text.trim() && containsBadContent(text)) {
      onBadContent && onBadContent(text.trim());
      setWarning(true);
      return;
    }
    setSending(true);
    await onSend(text.trim(), imageFile);
    setSending(false);
    setText(""); setImageFile(null); setImagePreview(null);
  }

  return (
    <div className="ch-chat-open">
      <div className="ch-chat-open-header">
        <span>Message</span>
        <button className="ch-btn text small" onClick={() => setOpen(false)}>Close</button>
      </div>
      {warning && <div className="ch-error" style={{ marginBottom: 10 }}>This text contains bad content — it wasn't sent, and it's been reported to the admin.</div>}
      {imagePreview && (
        <div className="ch-image-preview">
          <img src={imagePreview} alt="" />
          <button type="button" onClick={() => { setImageFile(null); setImagePreview(null); }}>×</button>
        </div>
      )}
      <div className="ch-chat-input-row">
        <ImagePicker image={null} compact onFile={(f) => { setImageFile(f); setImagePreview(URL.createObjectURL(f)); }} />
        <textarea
          className="ch-chat-textarea"
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="ch-btn solid small" disabled={sending || (!text.trim() && !imageFile)} onClick={send}>Send</button>
      </div>
    </div>
  );
}

function ChatRoomView({ forum, me, messages, onBack, onSend, onFlag }) {
  const canPost = me && (me.is_admin || me.verified);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  if (!forum) return <p className="ch-empty">Chat room not found.</p>;

  return (
    <div className="ch-message-panel" style={{ padding: "22px 26px 26px 26px" }}>
      <button className="ch-back" onClick={onBack} style={{ marginBottom: 14 }}>← All chats</button>
      <div className="ch-chat-header">
        <Avatar user={{ username: forum.name }} size="md" />
        <div>
          <h2 className="ch-serif" style={{ margin: 0, fontSize: 19 }}>{forum.name}</h2>
          {forum.description && <div className="ch-note" style={{ margin: 0 }}>{forum.description}</div>}
        </div>
      </div>

      <div className="ch-chat-scroll" ref={scrollRef}>
        {messages.map((m) => {
          const own = me && m.author?.id === me.id;
          return (
            <div className={`ch-msg-row ${own ? "own" : "other"}`} key={m.id}>
              <Avatar user={m.author} size="sm" />
              <div className="ch-msg-col">
                {!own && <div className="ch-msg-sender">{m.author?.username}</div>}
                <div className={`ch-bubble ${own ? "own" : "other"}`}>
                  {m.body && <span>{m.body}</span>}
                  {m.image_url && <img src={m.image_url} alt="" />}
                </div>
                <div className="ch-msg-time">{fmtTime(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <ChatBar
        canPost={canPost}
        disabledText={me ? "You need to be verified to send messages here." : "Log in to send messages."}
        placeholder="Message…"
        onSend={onSend}
        onBadContent={onFlag}
      />
    </div>
  );
}

function ActivityView({ target, items, loading, onBack }) {
  return (
    <div>
      <button className="ch-back" onClick={onBack}>← People</button>
      <h2 className="ch-serif">Everything from {target}</h2>
      {loading && <p className="ch-empty">Loading…</p>}
      {!loading && items.length === 0 && <p className="ch-empty">This person hasn't posted anything yet.</p>}
      {!loading && items.map((it, i) => (
        <div className="ch-activity-item" key={i}>
          <div className="room">{it.room} · {fmtDate(it.date)} {fmtTime(it.date)}</div>
          {it.body && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{it.body}</p>}
          {it.image && <img src={it.image} alt="" />}
        </div>
      ))}
    </div>
  );
}

function PeopleView({ profiles, me, onOpen }) {
  const [q, setQ] = useState("");
  const list = profiles
    .filter((u) => u.username.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.username.localeCompare(b.username));

  return (
    <div>
      <input className="ch-field" placeholder="Search people by username…" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length === 0 && <p className="ch-empty">No one matches that search.</p>}
      {list.map((u) => (
        <div className="ch-person-row" key={u.id} onClick={() => onOpen(u.id)} style={{ cursor: "pointer" }}>
          <Avatar user={u} size="md" />
          <div className="ch-person-meta">
            <div className="name">{u.username}</div>
            {u.country && <div className="country">{u.country}</div>}
          </div>
          {u.is_admin && <span className="ch-badge gold">Creator</span>}
          {!u.is_admin && u.verified && <span className="ch-badge moss">Verified</span>}
          {!u.is_admin && !u.verified && <span className="ch-badge plain">Pending</span>}
          {me?.is_admin && isLocked(u) && <span className="ch-badge danger">{lockLabel(u)}</span>}
        </div>
      ))}
    </div>
  );
}

function AuthView({ mode, error, setError, busy, onSetup, onSignup, onLogin }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [identifier, setIdentifier] = useState("");

  if (mode === "login") {
    return (
      <div style={{ maxWidth: 360 }}>
        <h2 className="ch-serif">Log in</h2>
        {error && <div className="ch-error">{error}</div>}
        <span className="ch-label">Username or email</span>
        <input className="ch-field" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        <span className="ch-label">Password</span>
        <input className="ch-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="ch-btn solid" disabled={busy} onClick={() => { setError(""); onLogin({ identifier, password }); }}>Log in</button>
      </div>
    );
  }

  const isSetup = mode === "setup";
  return (
    <div style={{ maxWidth: 360 }}>
      <h2 className="ch-serif">{isSetup ? "Set up your account" : "Sign up"}</h2>
      {isSetup && <p className="ch-note">No creator account exists yet — the first account made here becomes the site's admin.</p>}
      {error && <div className="ch-error">{error}</div>}
      <span className="ch-label">Username</span>
      <input className="ch-field" value={username} onChange={(e) => setUsername(e.target.value)} />
      <span className="ch-label">Email</span>
      <input className="ch-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <span className="ch-label">Password</span>
      <input className="ch-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <span className="ch-label">Confirm password</span>
      <input className="ch-field" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <button
        className="ch-btn solid"
        disabled={busy}
        onClick={() => { setError(""); if (isSetup) onSetup({ username, email, password }); else onSignup({ username, email, password, confirm }); }}
      >
        {isSetup ? "Create account" : "Sign up"}
      </button>
    </div>
  );
}

function AdminView({ profiles, settings, onBack, onSaveSettings, onVerify, onRemove, onLock, onUnlock, flags, onLoadFlags, onDismissFlag, onLockByUsername }) {
  const [siteName, setSiteName] = useState(settings.site_name);
  const [tagline, setTagline] = useState(settings.tagline);
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState(settings.banner_url || null);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [bannerPositionY, setBannerPositionY] = useState(settings.banner_position_y ?? 50);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => { onLoadFlags(); }, []);

  const pending = profiles.filter((u) => !u.is_admin && !u.verified);

  return (
    <div>
      <button className="ch-back" onClick={onBack}>← Back</button>
      <h2 className="ch-serif" style={{ marginTop: 0 }}>Controls</h2>

      <p className="ch-sub">Site settings</p>
      <div className="ch-card" style={{ marginBottom: 28 }}>
        <span className="ch-label">Site name</span>
        <input className="ch-field" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
        <span className="ch-label">Tagline</span>
        <input className="ch-field" value={tagline} onChange={(e) => setTagline(e.target.value)} />
        <span className="ch-label">Channel banner</span>
        <div style={{ marginBottom: 14 }}>
          <ImagePicker
            image={bannerPreview}
            onFile={(f) => { setBannerFile(f); setBannerPreview(URL.createObjectURL(f)); setRemoveBanner(false); }}
            onClear={() => { setBannerFile(null); setBannerPreview(null); setRemoveBanner(true); }}
          />
        </div>
        {bannerPreview && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ position: "relative", width: "100%", height: 110, overflow: "hidden", borderRadius: "var(--r-md)", marginBottom: 10 }}>
              <img src={bannerPreview} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: `center ${bannerPositionY}%` }} />
            </div>
            <span className="ch-label">Position</span>
            <input type="range" min="0" max="100" value={bannerPositionY} onChange={(e) => setBannerPositionY(Number(e.target.value))} style={{ width: "100%" }} />
          </div>
        )}
        <button
          className="ch-btn solid"
          onClick={async () => {
            await onSaveSettings({ site_name: siteName.trim() || "Double.net", tagline: tagline.trim(), bannerFile, removeBanner, banner_position_y: bannerPositionY });
            setBannerFile(null);
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 1500);
          }}
        >
          {savedFlash ? "Saved" : "Save settings"}
        </button>
      </div>

      <p className="ch-sub">Awaiting verification ({pending.length})</p>
      {pending.length === 0 && <p className="ch-empty">No one waiting.</p>}
      {pending.map((u) => (
        <div className="ch-row" key={u.id}>
          <span>{u.username} <span className="ch-note" style={{ margin: 0 }}>({u.email})</span></span>
          <div className="ch-row-actions">
            <button className="ch-btn small" onClick={() => onVerify(u.id)}>Verify</button>
            <LockControl user={u} onLock={(days) => onLock(u.id, days)} onUnlock={() => onUnlock(u.id)} />
            <DangerButton small label="Remove" onConfirm={() => onRemove(u.id)} />
          </div>
        </div>
      ))}

      <p className="ch-sub">Reported messages ({flags.length})</p>
      {flags.length === 0 && <p className="ch-empty">Nothing reported.</p>}
      {flags.map((f) => (
        <div className="ch-row" key={f.id} style={{ alignItems: "flex-start" }}>
          <div>
            <div><strong>{f.author?.username || "Unknown"}</strong> <span className="ch-note" style={{ margin: 0 }}>in {f.room} · {fmtDate(f.created_at)} {fmtTime(f.created_at)}</span></div>
            <div style={{ marginTop: 4 }}>{f.text}</div>
          </div>
          <div className="ch-row-actions">
            <button className="ch-btn small" onClick={() => onLockByUsername(f.author?.username, "7")}>Lock 7 days</button>
            <button className="ch-btn small" onClick={() => onDismissFlag(f.id)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
