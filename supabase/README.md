# Supabase setup

CLI authentication is not required. Open the Supabase SQL Editor and run
`outputs/maxvalue_supabase_setup.sql` once.

The combined SQL creates the schema, RLS policies, storage buckets, RPCs, store
master, initial seekers, offers, and gacha rates. It is idempotent and can be
run again when the seed is updated.

The storage migration creates:

- `user-images`
- `club-images`
- `gacha-images`

Until LINE Login is enabled, the app creates a browser-specific temporary LINE
user ID and stores all profile, offer, and gacha state in Supabase.
