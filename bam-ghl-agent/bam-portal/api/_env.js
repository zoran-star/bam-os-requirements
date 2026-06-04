// Env helpers — make missing config FAIL LOUDLY instead of silently.
//
// The codebase historically did `const KEY = process.env.X || ""` everywhere, so a
// deleted/rotated Vercel var stayed invisible until a user hit a broken flow. Use these
// in new code so a missing critical var surfaces immediately and clearly.

// Return the first env var that is set among `names`, else undefined.
export function firstEnv(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

// Like firstEnv, but THROW a clear error if none are set. Call at the top of a handler
// (inside the try/catch) so the function returns a real 500 with a useful message instead
// of failing deep inside an API call with a cryptic error.
export function requireEnv(...names) {
  const v = firstEnv(...names);
  if (!v) throw new Error(`Missing required env var: ${names.join(" or ")}`);
  return v;
}

// Presence check (boolean) — never returns the value, safe for /health output.
export function envPresent(...names) {
  return !!firstEnv(...names);
}
