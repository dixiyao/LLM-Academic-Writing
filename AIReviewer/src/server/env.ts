import path from "node:path";

export function envString(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = envString(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function envChoice<const T extends readonly string[]>(
  name: string,
  choices: T,
  fallback: T[number]
): T[number] {
  const raw = envString(name);
  return choices.includes(raw) ? raw : fallback;
}

export function resolveFromCwd(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export const serverEnv = {
  geminiApiKey: envString("GEMINI_API_KEY"),
  openRouterApiKey: envString("OPENROUTER_API_KEY"),
  geminiModel: envString("GEMINI_MODEL", "gemini-3-pro-preview"),
  geminiFastModel: envString("GEMINI_FAST_MODEL", "gemini-3-flash-preview"),
  openRouterModel: envString("OPENROUTER_MODEL", "openrouter/owl-alpha"),
  debateRounds: envInt("AI_REVIEWER_DEBATE_ROUNDS", 3, 0, 3),
  venueMode: envChoice(
    "AI_REVIEWER_VENUE_MODE",
    ["preset", "custom_template"] as const,
    "preset"
  ),
  venueId: envString("AI_REVIEWER_VENUE_ID", "neurips"),
  customVenueName: envString("AI_REVIEWER_CUSTOM_VENUE_NAME", "Custom Venue"),
  customVenueTemplatePath: envString("AI_REVIEWER_CUSTOM_VENUE_TEMPLATE_PATH"),
  dbPath: resolveFromCwd(envString("AI_REVIEWER_DB_PATH", "./data/aireviewer.sqlite")),
  uploadDir: resolveFromCwd(envString("AI_REVIEWER_UPLOAD_DIR", "./data/uploads")),
  allowFakeProvider:
    envString("AI_REVIEWER_ALLOW_FAKE_PROVIDER") === "1" ||
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
};
