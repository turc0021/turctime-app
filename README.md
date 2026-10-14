# Turc Time Training app (v1)
Static site (GitHub Pages) + Supabase (magic-link auth, Postgres + RLS, Realtime).

## Setup
1. Supabase > SQL Editor > paste `supabase/schema.sql` > Run. Edit the admin email at the bottom first. Safe to re-run.
2. Supabase > Authentication > URL Configuration: Site URL = `https://turc0021.github.io/turctime-app/`, add the same to Redirect URLs.
3. Copy the Project URL + anon public key into `config.js`.
4. Publish this folder to GitHub Pages (repo `turctime-app`, branch `main`, root).
5. Sign in with the admin email > Roster > Import CSV (prototype export) and set each family's login email.

Families sign in with the email on their family record (email or email2).
Do not put the service_role key anywhere in this folder.
`supabase/test/` is for local Postgres testing only.
