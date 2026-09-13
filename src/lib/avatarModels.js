// Free CC0 character models from Kenney (kenney.nl), used as-is under the
// Creative Commons Zero license. Each entry unlocks at a different level of
// site activity, tying the 3D avatar to real participation.
export const AVATAR_MODELS = [
  { key: "custom", file: "/models/custom-character.glb", label: "My Character", need: 0 },
  { key: "male-a", file: "/models/character-male-a.glb", label: "Male A", need: 0 },
  { key: "female-a", file: "/models/character-female-a.glb", label: "Female A", need: 0 },
  { key: "male-b", file: "/models/character-male-b.glb", label: "Male B", need: 1 },
  { key: "female-b", file: "/models/character-female-b.glb", label: "Female B", need: 1 },
  { key: "male-c", file: "/models/character-male-c.glb", label: "Male C", need: 2 },
  { key: "female-c", file: "/models/character-female-c.glb", label: "Female C", need: 2 },
  { key: "male-d", file: "/models/character-male-d.glb", label: "Male D", need: 3 },
  { key: "female-d", file: "/models/character-female-d.glb", label: "Female D", need: 3 },
];

export const AVATAR_ACCESSORIES = [
  { key: "glasses", file: "/models/aid-glasses.glb", label: "Glasses", need: 1 },
  { key: "sunglasses", file: "/models/aid-sunglasses.glb", label: "Sunglasses", need: 3 },
];

// need: 0 = everyone, 1 = Regular (10+ messages), 2 = Been here a while
// (30+ days), 3 = Creator. Mirrors computeBadges() in App.jsx.
export function unlockLevelFor(user, messageCount) {
  if (user?.is_admin) return 3;
  if (messageCount >= 10 || (Date.now() - new Date(user.created_at).getTime() > 30 * 24 * 60 * 60 * 1000)) return 2;
  if (messageCount >= 1) return 1;
  return 0;
}
