type Headers = Record<string, string | string[] | undefined>;

export function extractKey(headers: Headers): string | undefined {
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const xKey = headers["x-api-key"];
  if (typeof xKey === "string" && xKey.length > 0) return xKey;
  return undefined;
}
