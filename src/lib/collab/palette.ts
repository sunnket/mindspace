// Vivid, distinct peer colors — rose/pink/red lead so the first collaborators
// read as the "pink/red dot" the product asks for. All pass contrast on cream.
export const PEER_COLORS = [
  '#E93D82', // pink
  '#E5484D', // red
  '#3E63DD', // blue
  '#30A46C', // green
  '#F76B15', // orange
  '#8E4EC6', // purple
  '#0891B2', // teal
  '#C2410C', // rust
];

export function randomPeerColor(): string {
  return PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)];
}

/** Human-friendly session code: 6 chars, no ambiguous 0/O/1/I. */
export function generateSessionCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
