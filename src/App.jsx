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
function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

const ACCENT_COLORS = {
  gold: { label: "Gold", accent: "#A8752C", soft: "#F3E8D2" },
  moss: { label: "Moss", accent: "#4B7A5B", soft: "#E3EEE6" },
  terracotta: { label: "Terracotta", accent: "#B4553F", soft: "#F5E4DF" },
  slate: { label: "Slate", accent: "#4A5C7A", soft: "#E2E7EE" },
  rose: { label: "Rose", accent: "#A34A6B", soft: "#F3E1E8" },
};
const REACTION_EMOJIS = ["👍", "❤️", "😂", "🔥", "😮"];

function accentStyle(user) {
  const c = ACCENT_COLORS[user?.accent_color] || ACCENT_COLORS.gold;
  return { "--gold": c.accent, "--gold-soft": c.soft };
}

// Renders text with @username mentions highlighted, when the username
// actually matches someone on the site.
function MentionText({ text, profiles }) {
  if (!text) return null;
  const known = new Set(profiles.map((p) => p.username.toLowerCase()));
  const parts = text.split(/(@\w+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("@") && known.has(part.slice(1).toLowerCase())) {
          return <span key={i} className="ch-mention">{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function computeBadges(user, messageCount) {
  const badges = [];
  if (user.is_admin) badges.push({ icon: "👑", label: "Creator" });
  if (messageCount >= 1) badges.push({ icon: "💬", label: "First message" });
  if (messageCount >= 10) badges.push({ icon: "🗣️", label: "Regular" });
  if (Date.now() - new Date(user.created_at).getTime() > 30 * 24 * 60 * 60 * 1000) {
    badges.push({ icon: "📅", label: "Been here a while" });
  }
  return badges;
}

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
  const [me, setMe] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [officialPosts, setOfficialPosts] = useState([]);
  const [postComments, setPostComments] = useState({}); // post_id -> [comment,...]
  const [forums, setForums] = useState([]);
  const [trendingForumId, setTrendingForumId] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [view, setView] = useState("home");
  const [activeForumId, setActiveForumId] = useState(null);
  const [activeForumMessages, setActiveForumMessages] = useState([]);
  const [activeForumPolls, setActiveForumPolls] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activityTarget, setActivityTarget] = useState(null);
  const [activityItems, setActivityItems] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [personId, setPersonId] = useState(null);
  const [flags, setFlags] = useState([]);
  const [friendships, setFriendships] = useState([]); // all rows involving me

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
    const [{ data: settingsRow }, { data: forumsRows }, { data: postsRows }, { data: profileRows }, { count: adminCount }, { data: commentsRows }] =
      await Promise.all([
        supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
        supabase.from("forums").select("*").order("created_at"),
        supabase.from("official_posts").select("*, author:profiles(username, avatar_url)").order("created_at", { ascending: false }),
        supabase.from("profiles").select("*").order("username"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true),
        supabase.from("post_comments").select("*, author:profiles(username, avatar_url)").order("created_at"),
      ]);
    if (settingsRow) setSettings(settingsRow);
    setForums(forumsRows || []);
    setOfficialPosts(postsRows || []);
    setProfiles(profileRows || []);
    setNeedsSetup(!adminCount);
    const grouped = {};
    (commentsRows || []).forEach((c) => { (grouped[c.post_id] ||= []).push(c); });
    setPostComments(grouped);
  }

  async function loadFriendships(myId) {
    const { data } = await supabase
      .from("friendships")
      .select("*, requester:profiles!friendships_requester_id_fkey(username, avatar_url), addressee:profiles!friendships_addressee_id_fkey(username, avatar_url)")
      .or(`requester_id.eq.${myId},addressee_id.eq.${myId}`);
    setFriendships(data || []);
  }

  useEffect(() => {
    (async () => {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession?.user) {
        await loadMe(authSession.user.id);
        await loadFriendships(authSession.user.id);
      }
      await loadAll();
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession?.user) { loadMe(newSession.user.id); loadFriendships(newSession.user.id); }
      else { setMe(null); setFriendships([]); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadForumMessages(forumId) {
    const [{ data: msgs }, { data: polls }] = await Promise.all([
      supabase.from("messages").select("*, author:profiles(id, username, avatar_url, is_admin, verified)").eq("forum_id", forumId).order("created_at"),
      supabase.from("polls").select("*, author:profiles(id, username), poll_votes(user_id, option_id)").eq("forum_id", forumId).order("created_at"),
    ]);
    setActiveForumMessages(msgs || []);
    setActiveForumPolls(polls || []);
  }

  function openForum(forumId) {
    setActiveForumId(forumId);
    setView("forum");
    loadForumMessages(forumId);
  }

  async function openForums() {
    setView("forums");
    const { data } = await supabase.from("messages").select("forum_id");
    if (data && data.length) {
      const counts = {};
      data.forEach((m) => { counts[m.forum_id] = (counts[m.forum_id] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      setTrendingForumId(top ? top[0] : null);
    } else {
      setTrendingForumId(null);
    }
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
    const { data } = await supabase.from("flags").select("*, author:profiles(username)").order("created_at", { ascending: false });
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
    const person = profiles.find((p) => p.id === userId);
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

  // ---------- friends ----------
  function friendStatusWith(otherId) {
    const row = friendships.find((f) => (f.requester_id === otherId || f.addressee_id === otherId));
    if (!row) return { status: "none" };
    if (row.status === "accepted") return { status: "friends", row };
    if (row.requester_id === me.id) return { status: "pending_sent", row };
    return { status: "pending_received", row };
  }
  async function sendFriendRequest(otherId) {
    await supabase.from("friendships").insert({ requester_id: me.id, addressee_id: otherId });
    loadFriendships(me.id);
  }
  async function acceptFriendRequest(rowId) {
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", rowId);
    loadFriendships(me.id);
  }
  async function removeFriendship(rowId) {
    await supabase.from("friendships").delete().eq("id", rowId);
    loadFriendships(me.id);
  }

  // ---------- reactions ----------
  async function toggleReaction(message, emoji) {
    const reactions = { ...(message.reactions || {}) };
    const list = new Set(reactions[emoji] || []);
    if (list.has(me.id)) list.delete(me.id); else list.add(me.id);
    reactions[emoji] = Array.from(list);
    if (reactions[emoji].length === 0) delete reactions[emoji];
    await supabase.from("messages").update({ reactions }).eq("id", message.id);
    setActiveForumMessages((msgs) => msgs.map((m) => (m.id === message.id ? { ...m, reactions } : m)));
  }

  if (!ready) {
    return <div className="ch-root"><div className="ch-shell"><div className="ch-loading">Loading…</div></div></div>;
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
    <div className="ch-root" style={accentStyle(me)}>
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
          <button className={`ch-tab ${view === "forums" || view === "forum" ? "active" : ""}`} onClick={openForums}>Chats</button>
          <button className={`ch-tab ${view === "people" ? "active" : ""}`} onClick={() => setView("people")}>People</button>
          {me && <button className={`ch-tab ${view === "profile" ? "active" : ""}`} onClick={() => setView("profile")}>Profile</button>}
        </div>

        {view === "home" && (
          <HomeView
            me={me}
            posts={officialPosts}
            comments={postComments}
            profiles={profiles}
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
            onComment={async (postId, text) => {
              const { data } = await supabase.from("post_comments").insert({ post_id: postId, author_id: me.id, body: text }).select("*, author:profiles(username, avatar_url)").single();
              if (data) setPostComments((c) => ({ ...c, [postId]: [...(c[postId] || []), data] }));
            }}
          />
        )}

        {view === "forums" && (
          <ForumsView
            me={me}
            forums={forums}
            trendingForumId={trendingForumId}
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
            profiles={profiles}
            messages={activeForumMessages}
            polls={activeForumPolls}
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
            onReact={toggleReaction}
            onCreatePoll={async (question, options) => {
              const opts = options.map((text, i) => ({ id: String(i), text }));
              await supabase.from("polls").insert({ forum_id: activeForumId, author_id: me.id, question, options: opts });
              loadForumMessages(activeForumId);
            }}
            onVote={async (pollId, optionId) => {
              await supabase.from("poll_votes").upsert({ poll_id: pollId, user_id: me.id, option_id: optionId });
              loadForumMessages(activeForumId);
            }}
            onSavePinned={async (text) => {
              await supabase.from("forums").update({ pinned_message: text }).eq("id", activeForumId);
              setForums((f) => f.map((x) => (x.id === activeForumId ? { ...x, pinned_message: text } : x)));
            }}
          />
        )}

        {view === "people" && (
          <PeopleView profiles={profiles} me={me} onOpen={(id) => { setPersonId(id); setView("person"); }} />
        )}

        {view === "person" && personId && profiles.find((p) => p.id === personId) && (
          <PersonProfileView
            user={profiles.find((p) => p.id === personId)}
            viewer={me}
            friendInfo={me ? friendStatusWith(personId) : { status: "none" }}
            onSendFriendRequest={() => sendFriendRequest(personId)}
            onAcceptFriend={(rowId) => acceptFriendRequest(rowId)}
            onRemoveFriend={(rowId) => removeFriendship(rowId)}
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
            friendships={friendships}
            profiles={profiles}
            onAcceptFriend={acceptFriendRequest}
            onRemoveFriend={removeFriendship}
            onOpenPerson={(pid) => { setPersonId(pid); setView("person"); }}
            onSaveProfile={async ({ avatarFile, country, bio, currentAvatarUrl, accentColor }) => {
              let avatar_url = currentAvatarUrl;
              if (avatarFile) avatar_url = await uploadImage(avatarFile, `avatars/${me.id}`);
              await supabase.from("profiles").update({ avatar_url, country, bio, accent_color: accentColor }).eq("id", me.id);
              setMe((m) => ({ ...m, avatar_url, country, bio, accent_color: accentColor }));
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
              const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                email: email.trim(), password, options: { data: { username: username.trim() } },
              });
              if (signUpError) { setError(signUpError.message); setBusy(false); return; }
              if (!signUpData.session) { setError("Check your email to confirm your account, then log in."); setBusy(false); return; }
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
              const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                email: email.trim(), password, options: { data: { username: username.trim() } },
              });
              if (signUpError) {
                setError(signUpError.message.includes("registered") ? "An account with that email already exists — log in instead." : signUpError.message);
                setBusy(false);
                return;
              }
              if (!signUpData.session) { setError("Check your email to confirm your account, then log in."); setBusy(false); return; }
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
              loadFriendships(profile.id);
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
  if (!confirming) return <button className={`ch-btn danger ${small ? "small" : ""}`} onClick={() => setConfirming(true)}>{label}</button>;
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

function ReactionBar({ message, me, onReact }) {
  const reactions = message.reactions || {};
  const canReact = me && (me.is_admin || me.verified);
  return (
    <div className="ch-reaction-bar">
      {Object.entries(reactions).filter(([, users]) => users.length > 0).map(([emoji, users]) => (
        <button
          key={emoji}
          className={`ch-reaction-pill ${users.includes(me?.id) ? "mine" : ""}`}
          onClick={() => canReact && onReact(message, emoji)}
        >
          {emoji} {users.length}
        </button>
      ))}
      {canReact && (
        <div className="ch-reaction-add">
          <button className="ch-reaction-pill add">+</button>
          <div className="ch-reaction-picker">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} onClick={() => onReact(message, e)}>{e}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PollCard({ poll, me, onVote }) {
  const votes = poll.poll_votes || [];
  const myVote = votes.find((v) => v.user_id === me?.id);
  const total = votes.length;
  const canVote = me && (me.is_admin || me.verified);
  return (
    <div className="ch-poll-card">
      <div className="ch-poll-question">📊 {poll.question}</div>
      {poll.options.map((opt) => {
        const count = votes.filter((v) => v.option_id === opt.id).length;
        const pct = total ? Math.round((count / total) * 100) : 0;
        const mine = myVote?.option_id === opt.id;
        return (
          <button
            key={opt.id}
            className={`ch-poll-option ${mine ? "mine" : ""}`}
            disabled={!canVote}
            onClick={() => onVote(poll.id, opt.id)}
          >
            <div className="ch-poll-fill" style={{ width: `${pct}%` }} />
            <span className="ch-poll-label">{opt.text}</span>
            <span className="ch-poll-pct">{pct}% ({count})</span>
          </button>
        );
      })}
      <div className="ch-poll-meta">{poll.author?.username} · {fmtDate(poll.created_at)}</div>
    </div>
  );
}

function ProfileView({ me, friendships, profiles, onAcceptFriend, onRemoveFriend, onOpenPerson, onSaveProfile, onRenameUsername }) {
  const [avatarFile, setAvatarFile] = useState(null);
  const [country, setCountry] = useState(me.country || "");
  const [bio, setBio] = useState(me.bio || "");
  const [accentColor, setAccentColor] = useState(me.accent_color || "gold");
  const [savedFlash, setSavedFlash] = useState(false);
  const [username, setUsername] = useState(me.username);
  const [usernameError, setUsernameError] = useState("");
  const [usernameSaved, setUsernameSaved] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [messageCount, setMessageCount] = useState(0);

  useEffect(() => {
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("author_id", me.id).then(({ count }) => setMessageCount(count || 0));
  }, [me.id]);

  const pendingReceived = friendships.filter((f) => f.status === "pending" && f.addressee_id === me.id);
  const friends = friendships.filter((f) => f.status === "accepted");
  const badges = computeBadges(me, messageCount);

  return (
    <div>
      <div className="ch-profile-head">
        <Avatar user={me} size="lg" />
        <div>
          <h2 className="ch-serif" style={{ margin: "0 0 4px 0" }}>{me.username}</h2>
          <div className="ch-note" style={{ margin: 0 }}>{me.email}</div>
          <div className="ch-badge-row">{badges.map((b, i) => <span key={i} className="ch-achievement" title={b.label}>{b.icon} {b.label}</span>)}</div>
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
              setRenaming(true); setUsernameError("");
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

      <p className="ch-sub">Friend requests ({pendingReceived.length})</p>
      {pendingReceived.length === 0 && <p className="ch-empty">No pending requests.</p>}
      {pendingReceived.map((f) => (
        <div className="ch-row" key={f.id}>
          <span onClick={() => onOpenPerson(f.requester_id)} style={{ cursor: "pointer" }}>{f.requester?.username}</span>
          <div className="ch-row-actions">
            <button className="ch-btn small" onClick={() => onAcceptFriend(f.id)}>Accept</button>
            <button className="ch-btn text small" onClick={() => onRemoveFriend(f.id)}>Decline</button>
          </div>
        </div>
      ))}

      <p className="ch-sub">Friends ({friends.length})</p>
      {friends.length === 0 && <p className="ch-empty">No friends yet — add some from People.</p>}
      {friends.map((f) => {
        const other = f.requester_id === me.id ? f.addressee : f.requester;
        const otherId = f.requester_id === me.id ? f.addressee_id : f.requester_id;
        return (
          <div className="ch-row" key={f.id}>
            <span onClick={() => onOpenPerson(otherId)} style={{ cursor: "pointer" }}>{other?.username}</span>
            <DangerButton small label="Remove" onConfirm={() => onRemoveFriend(f.id)} />
          </div>
        );
      })}

      <p className="ch-sub">Profile photo & details</p>
      <div className="ch-card">
        <span className="ch-label">Profile photo</span>
        <div style={{ marginBottom: 18 }}><ImagePicker image={me.avatar_url} onFile={setAvatarFile} onClear={() => setAvatarFile(null)} /></div>

        <span className="ch-label">Country</span>
        <select className="ch-field" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">Prefer not to say</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <span className="ch-label">Bio</span>
        <textarea className="ch-field" rows={4} placeholder="Tell people a bit about yourself…" value={bio} onChange={(e) => setBio(e.target.value)} />

        <span className="ch-label">Accent color</span>
        <div className="ch-swatch-row">
          {Object.entries(ACCENT_COLORS).map(([key, c]) => (
            <button
              key={key}
              className={`ch-swatch ${accentColor === key ? "active" : ""}`}
              style={{ background: c.accent }}
              title={c.label}
              onClick={() => setAccentColor(key)}
            />
          ))}
        </div>

        <button
          className="ch-btn solid"
          style={{ marginTop: 18 }}
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSaveProfile({ avatarFile, country, bio, currentAvatarUrl: me.avatar_url, accentColor });
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

function PersonProfileView({ user, viewer, friendInfo, onSendFriendRequest, onAcceptFriend, onRemoveFriend, onBack, onViewActivity, onVerify, onUnverify, onPromote, onRemove, onLock, onUnlock }) {
  const isAdmin = viewer?.is_admin;
  const isSelf = viewer && viewer.id === user.id;
  const [messageCount, setMessageCount] = useState(0);

  useEffect(() => {
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("author_id", user.id).then(({ count }) => setMessageCount(count || 0));
  }, [user.id]);

  const badges = computeBadges(user, messageCount);

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
          <div className="ch-badge-row">{badges.map((b, i) => <span key={i} className="ch-achievement" title={b.label}>{b.icon} {b.label}</span>)}</div>
        </div>
      </div>

      {!isSelf && viewer && (
        <div style={{ marginBottom: 20 }}>
          {friendInfo.status === "none" && <button className="ch-btn solid" onClick={onSendFriendRequest}>Add friend</button>}
          {friendInfo.status === "pending_sent" && <button className="ch-btn" disabled>Request sent</button>}
          {friendInfo.status === "pending_received" && (
            <span style={{ display: "flex", gap: 8 }}>
              <button className="ch-btn solid" onClick={() => onAcceptFriend(friendInfo.row.id)}>Accept friend request</button>
              <button className="ch-btn text" onClick={() => onRemoveFriend(friendInfo.row.id)}>Decline</button>
            </span>
          )}
          {friendInfo.status === "friends" && (
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="ch-badge moss">Friends</span>
              <DangerButton small label="Remove friend" onConfirm={() => onRemoveFriend(friendInfo.row.id)} />
            </span>
          )}
        </div>
      )}

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
                  {user.verified ? <button className="ch-btn small" onClick={onUnverify}>Revoke verification</button> : <button className="ch-btn small" onClick={onVerify}>Verify</button>}
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

function CommentsSection({ post, comments, me, onComment }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const canComment = me && (me.is_admin || me.verified);
  const list = comments || [];

  return (
    <div className="ch-comments">
      <button className="ch-btn text small" onClick={() => setOpen((o) => !o)}>
        💬 {list.length === 0 ? "Comment" : `${list.length} comment${list.length === 1 ? "" : "s"}`}
      </button>
      {open && (
        <div className="ch-comments-body">
          {list.map((c) => (
            <div className="ch-comment-row" key={c.id}>
              <Avatar user={c.author} size="sm" />
              <div>
                <div className="ch-meta" style={{ marginBottom: 2 }}>{c.author?.username} · {fmtDate(c.created_at)}</div>
                <div>{c.body}</div>
              </div>
            </div>
          ))}
          {canComment ? (
            <div className="ch-comment-input-row">
              <input className="ch-field" style={{ marginBottom: 0 }} placeholder="Write a comment…" value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onComment(post.id, text.trim()); setText(""); } }} />
              <button className="ch-btn solid small" disabled={!text.trim()} onClick={() => { onComment(post.id, text.trim()); setText(""); }}>Post</button>
            </div>
          ) : (
            <p className="ch-note" style={{ marginBottom: 0 }}>{me ? "You need to be verified to comment." : "Log in to comment."}</p>
          )}
        </div>
      )}
    </div>
  );
}

function HomeView({ me, posts, comments, profiles, onPost, onDelete, onTogglePin, onComment }) {
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
          <div style={{ marginBottom: 14 }}><ImagePicker image={null} onFile={setImageFile} onClear={() => setImageFile(null)} /></div>
          <button
            className="ch-btn solid"
            disabled={posting || !title.trim() || !body.trim()}
            onClick={async () => { setPosting(true); await onPost({ title: title.trim(), body: body.trim(), imageFile }); setTitle(""); setBody(""); setImageFile(null); setPosting(false); }}
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
            <p><MentionText text={p.body} profiles={profiles} /></p>
            {p.image_url && <img src={p.image_url} alt="" />}
            {me?.is_admin && (
              <div className="ch-card-actions">
                <button className="ch-btn small" onClick={() => onTogglePin(p)}>{p.pinned ? "Unpin" : "Pin"}</button>
                <DangerButton small onConfirm={() => onDelete(p.id)} />
              </div>
            )}
            <CommentsSection post={p} comments={comments[p.id]} me={me} onComment={onComment} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ForumsView({ me, forums, trendingForumId, onOpen, onCreate, onDelete }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        {me?.is_admin && <button className="ch-btn" onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Cancel" : "New chat room"}</button>}
      </div>

      {showCreate && (
        <div className="ch-compose">
          <input className="ch-field" placeholder="Room name (e.g. Support)" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="ch-field" rows={2} placeholder="What's this room about?" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button className="ch-btn solid" disabled={!name.trim()} onClick={async () => { await onCreate({ name: name.trim(), description: desc.trim() }); setName(""); setDesc(""); setShowCreate(false); }}>Create room</button>
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
              <h3 className="ch-serif">{f.name} {f.id === trendingForumId && <span className="ch-trending">🔥 Trending</span>}</h3>
              <p>{f.description}</p>
            </div>
          </div>
          {me?.is_admin && <div onClick={(e) => e.stopPropagation()}><DangerButton small onConfirm={() => onDelete(f.id)} /></div>}
        </div>
      ))}
    </div>
  );
}

function ChatBar({ canPost, disabledText, placeholder, profiles, onSend, onBadContent, onCreatePoll }) {
  const [open, setOpen] = useState(false);
  const [pollMode, setPollMode] = useState(false);
  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [warning, setWarning] = useState(false);
  const [sending, setSending] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState([]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);

  useEffect(() => {
    if (!warning) return;
    const t = setTimeout(() => setWarning(false), 4000);
    return () => clearTimeout(t);
  }, [warning]);

  if (!canPost) return <p className="ch-note" style={{ marginTop: 20 }}>{disabledText}</p>;
  if (!open) return <button className="ch-chat-pill" onClick={() => setOpen(true)}>{placeholder}</button>;

  function handleTextChange(v) {
    setText(v);
    const match = v.match(/@(\w*)$/);
    if (match) {
      const partial = match[1].toLowerCase();
      setMentionSuggestions(profiles.filter((p) => p.username.toLowerCase().startsWith(partial)).slice(0, 5));
    } else {
      setMentionSuggestions([]);
    }
  }
  function pickMention(username) {
    setText((t) => t.replace(/@(\w*)$/, `@${username} `));
    setMentionSuggestions([]);
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

  if (pollMode) {
    return (
      <div className="ch-chat-open">
        <div className="ch-chat-open-header">
          <span>New poll</span>
          <button className="ch-btn text small" onClick={() => setPollMode(false)}>Back to message</button>
        </div>
        <input className="ch-field" placeholder="Ask a question…" value={question} onChange={(e) => setQuestion(e.target.value)} />
        {options.map((opt, i) => (
          <input
            key={i} className="ch-field" placeholder={`Option ${i + 1}`} value={opt}
            onChange={(e) => setOptions((o) => o.map((x, idx) => (idx === i ? e.target.value : x)))}
          />
        ))}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {options.length < 4 && <button className="ch-btn small" onClick={() => setOptions((o) => [...o, ""])}>Add option</button>}
          {options.length > 2 && <button className="ch-btn small" onClick={() => setOptions((o) => o.slice(0, -1))}>Remove option</button>}
        </div>
        <button
          className="ch-btn solid"
          disabled={!question.trim() || options.filter((o) => o.trim()).length < 2}
          onClick={async () => {
            await onCreatePoll(question.trim(), options.map((o) => o.trim()).filter(Boolean));
            setQuestion(""); setOptions(["", ""]); setPollMode(false); setOpen(false);
          }}
        >
          Post poll
        </button>
      </div>
    );
  }

  return (
    <div className="ch-chat-open">
      <div className="ch-chat-open-header">
        <span>Message</span>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="ch-btn text small" onClick={() => setPollMode(true)}>📊 Poll</button>
          <button className="ch-btn text small" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
      {warning && <div className="ch-error" style={{ marginBottom: 10 }}>This text contains bad content — it wasn't sent, and it's been reported to the admin.</div>}
      {imagePreview && (
        <div className="ch-image-preview"><img src={imagePreview} alt="" /><button type="button" onClick={() => { setImageFile(null); setImagePreview(null); }}>×</button></div>
      )}
      <div style={{ position: "relative" }}>
        {mentionSuggestions.length > 0 && (
          <div className="ch-mention-suggestions">
            {mentionSuggestions.map((p) => <button key={p.id} onClick={() => pickMention(p.username)}>@{p.username}</button>)}
          </div>
        )}
        <div className="ch-chat-input-row">
          <ImagePicker image={null} compact onFile={(f) => { setImageFile(f); setImagePreview(URL.createObjectURL(f)); }} />
          <textarea
            className="ch-chat-textarea" rows={1} placeholder={placeholder} value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="ch-btn solid small" disabled={sending || (!text.trim() && !imageFile)} onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
}

function ChatRoomView({ forum, me, profiles, messages, polls, onBack, onSend, onFlag, onReact, onCreatePoll, onVote, onSavePinned }) {
  const canPost = me && (me.is_admin || me.verified);
  const scrollRef = useRef(null);
  const [editingPinned, setEditingPinned] = useState(false);
  const [pinnedDraft, setPinnedDraft] = useState(forum?.pinned_message || "");

  const feed = [
    ...messages.map((m) => ({ type: "message", date: m.created_at, data: m })),
    ...polls.map((p) => ({ type: "poll", date: p.created_at, data: p })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [feed.length]);

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

      {(forum.pinned_message || me?.is_admin) && (
        <div className="ch-pinned-banner">
          {editingPinned ? (
            <div style={{ width: "100%" }}>
              <textarea className="ch-field" rows={2} value={pinnedDraft} onChange={(e) => setPinnedDraft(e.target.value)} placeholder="Set a pinned welcome message for this room…" />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="ch-btn solid small" onClick={() => { onSavePinned(pinnedDraft.trim()); setEditingPinned(false); }}>Save</button>
                <button className="ch-btn text small" onClick={() => setEditingPinned(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <span>📌 {forum.pinned_message || <em>No welcome message set.</em>}</span>
              {me?.is_admin && <button className="ch-btn text small" onClick={() => setEditingPinned(true)}>Edit</button>}
            </>
          )}
        </div>
      )}

      <div className="ch-chat-scroll" ref={scrollRef}>
        {feed.map((item) => {
          if (item.type === "poll") return <PollCard key={`poll-${item.data.id}`} poll={item.data} me={me} onVote={onVote} />;
          const m = item.data;
          const own = me && m.author?.id === me.id;
          return (
            <div className={`ch-msg-row ${own ? "own" : "other"}`} key={m.id}>
              <Avatar user={m.author} size="sm" />
              <div className="ch-msg-col">
                {!own && <div className="ch-msg-sender">{m.author?.username}</div>}
                <div className={`ch-bubble ${own ? "own" : "other"}`}>
                  {m.body && <span><MentionText text={m.body} profiles={profiles} /></span>}
                  {m.image_url && <img src={m.image_url} alt="" />}
                </div>
                <div className="ch-msg-time">{fmtTime(m.created_at)}</div>
                <ReactionBar message={m} me={me} onReact={onReact} />
              </div>
            </div>
          );
        })}
      </div>

      <ChatBar
        canPost={canPost}
        disabledText={me ? "You need to be verified to send messages here." : "Log in to send messages."}
        placeholder="Message…"
        profiles={profiles}
        onSend={onSend}
        onBadContent={onFlag}
        onCreatePoll={onCreatePoll}
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
  const list = profiles.filter((u) => u.username.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.username.localeCompare(b.username));

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
        className="ch-btn solid" disabled={busy}
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
