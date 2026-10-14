// Copy to config.js and fill in from Supabase > Project Settings > API.
// The anon (public) key is safe to ship in a static site; RLS protects the data.
window.TURC_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  COACH_NAME: "Coach Turc",
  SESSION_PRICE: 50,
  DEFAULT_SLOT_MINUTES: 60,
  TIMEZONE_LABEL: "ET"
};
