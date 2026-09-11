// Basic client-side profanity filter. Catches common cuss words and simple
// censoring like "f**k". This is a soft deterrent, not real moderation
// security -- a determined person could still call the Supabase API
// directly and bypass this, since there's no server enforcing it. If you
// want that closed, add a Postgres check constraint or an Edge Function
// that re-runs this same check server-side before inserting a message.
const BAD_WORDS = [
  "fuck", "shit", "bitch", "asshole", "bastard", "dick", "piss", "cunt",
  "slut", "whore", "crap", "damn", "cock", "pussy", "douche",
];

const LEET_MAP = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "$": "s", "@": "a" };

export function containsBadContent(text) {
  const tokens = text.toLowerCase().split(/\s+/);
  for (const raw of tokens) {
    let cleaned = raw.replace(/[^a-z0-9*$@]/g, "");
    cleaned = cleaned.split("").map((ch) => LEET_MAP[ch] ?? ch).join("");
    if (!cleaned) continue;
    for (const bad of BAD_WORDS) {
      if (cleaned.includes(bad)) return true;
      if (cleaned.includes("*")) {
        const pattern = cleaned.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".{1,3}");
        if (pattern && new RegExp(`^${pattern}$`).test(bad)) return true;
      }
    }
  }
  return false;
}
