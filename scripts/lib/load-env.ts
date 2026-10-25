// Next.js loads .env.local itself; standalone scripts have to do it. Existing
// variables win, so CI secrets are never overridden by a stray file.
export function loadLocalEnv(file = ".env.local"): void {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
