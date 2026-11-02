export function validateEnvironment(config: Record<string, unknown>) {
  const databaseUrl = config.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required. Run npm run db:setup or configure backend/.env.');
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL.');
  }
  const dataKey = config.HR_DATA_KEY;
  if (typeof dataKey !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(dataKey) || Buffer.from(dataKey, "base64").length !== 32) {
    throw new Error("HR_DATA_KEY must be a base64-encoded 32-byte encryption key. Run npm run db:setup for the managed demo; preserve this key when backing up contracts.");
  }
  const port = Number(config.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(config[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(key + ' must be a positive integer <= ' + max);
    return value;
  };
  if (config.COOKIE_SECURE !== undefined && !['true', 'false'].includes(String(config.COOKIE_SECURE))) throw new Error('COOKIE_SECURE must be true or false.');
  const origins = String(config.WEB_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173');
  for (const value of origins.split(',')) {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value.trim()) throw new Error('WEB_ORIGINS must list exact HTTP(S) origins.');
  }
  return { ...config, DATABASE_URL: databaseUrl, PORT: port, HOST: config.HOST ?? '127.0.0.1',
    AUTH_IDLE_MINUTES: integer('AUTH_IDLE_MINUTES', 15, 1440), AUTH_ABSOLUTE_HOURS: integer('AUTH_ABSOLUTE_HOURS', 8, 168),
    AUTH_MAX_FAILURES: integer('AUTH_MAX_FAILURES', 5, 100), AUTH_LOCK_MINUTES: integer('AUTH_LOCK_MINUTES', 15, 1440),
    COOKIE_SECURE: String(config.COOKIE_SECURE ?? 'false'), WEB_ORIGINS: origins };
}
