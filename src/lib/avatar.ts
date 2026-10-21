// Deterministic gradient so each account gets its own recognisable avatar.
export const avatarGradient = (address: string) => {
  const h1 = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = parseInt(address.slice(-6), 16) % 360;
  return `linear-gradient(135deg, hsl(${h1} 80% 60%), hsl(${h2} 80% 50%))`;
};
