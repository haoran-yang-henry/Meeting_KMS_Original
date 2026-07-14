// Runtime configuration placeholder.
// In container deployments this file is overwritten at startup by
// docker/40-runtime-env.sh with the actual Supabase URL and anon key.
// On static hosts (GitHub Pages) it stays empty and the app uses the
// values baked in at build time.
window.__ENV = window.__ENV || {};
