// Imported first so .env is loaded before any other module reads process.env.
try {
  process.loadEnvFile();
} catch {
  // no .env file, rely on the real environment
}
