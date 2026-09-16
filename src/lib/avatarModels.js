// Free CC0 character models from Kenney (kenney.nl), used as-is under the
// Creative Commons Zero license. Each entry unlocks at a different level of
// site activity, tying the 3D avatar to real participation.
export const AVATAR_MODELS = [
  { key: "hoodie", file: "/models/hoodie-character.glb", label: "My Character", need: 0, customizable: true },
];

// Reference colors baked into hoodie-character.glb, and the palettes players
// can choose between. Kept here (not in Avatar3D.jsx) so importing them
// doesn't drag the heavy Three.js component into the main bundle.
export const HOODIE_REFERENCE = {
  hair: [107, 68, 35],
  blue: [0, 127, 255],
  lightblue: [0, 255, 255],
  black: [0, 0, 0],
  skin: [255, 255, 0],
};

export const HAIR_COLORS = {
  brown: [107, 68, 35],
  darkbrown: [59, 41, 28],
  black: [20, 20, 20],
  blond: [212, 175, 100],
};

export const CLOTHING_SCHEMES = {
  normal: { blue: [0, 127, 255], lightblue: [0, 255, 255] },
  green: { blue: [34, 139, 34], lightblue: [0, 100, 0] },
  "black-orange": { blue: [15, 15, 15], lightblue: [255, 140, 0] },
};

export const AVATAR_ACCESSORIES = [];

// need: 0 = everyone, 1 = Regular (10+ messages), 2 = Been here a while
// (30+ days), 3 = Creator. Mirrors computeBadges() in App.jsx.
export function unlockLevelFor(user, messageCount) {
  if (user?.is_admin) return 3;
  if (messageCount >= 10 || (Date.now() - new Date(user.created_at).getTime() > 30 * 24 * 60 * 60 * 1000)) return 2;
  if (messageCount >= 1) return 1;
  return 0;
}
