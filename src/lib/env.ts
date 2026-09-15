import "server-only";

/**
 * Reads a required environment variable.
 *
 * Deliberately lazy: calling this at module scope would break `next build`,
 * which imports every route without a populated environment.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** Public origin of the app, e.g. https://tools.example.com. No trailing slash. */
export function appUrl(): string {
  return requireEnv("APP_URL").replace(/\/+$/, "");
}

/** Google accounts permitted to sign in, lowercased. */
export function allowedEmails(): string[] {
  return requireEnv("ALLOWED_EMAILS")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
