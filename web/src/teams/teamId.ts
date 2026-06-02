export function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return s || "team";
}

function randomSuffix(): string {
  // base36 of Math.random() yields [0-9a-z]; take 4, pad if short.
  return Math.random().toString(36).slice(2, 6).padEnd(4, "0");
}

export function teamIdFromName(name: string, suffix: () => string = randomSuffix): string {
  return `${slugify(name)}-${suffix()}`;
}
