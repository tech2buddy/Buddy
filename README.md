# Buddy Loans

Buddy Loans is a mobile-first student account and loan application website. The interface uses plain HTML, CSS, and JavaScript; Supabase provides account and data services.

## Project layout

- `dist/` contains the website pages, styles, scripts, and brand assets served in production.
- `scripts/build.mjs` writes the browser-safe Supabase runtime configuration into the deployment output.
- `supabase/migrations/` contains the database changes applied to the Supabase project.
- `*.md` design notes document product and interface decisions.
- `vercel.json` configures the build output and clean page URLs for Vercel.

## Local setup

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env.local` and enter the Supabase project URL and **publishable key**.
3. Run `npm run build`.
4. Serve the `dist/` folder with any local static web server.

`.env.local` and the generated `dist/runtime-config.js` are ignored by Git. The build rejects service-role and secret keys. Supabase publishable keys are intended for browser use; database tables and storage still need correct row-level security policies.

## Deploy to Vercel

Import this GitHub repository into Vercel and add these Project Environment Variables for Production, Preview, and Development:

- `BUDDY_SUPABASE_URL`
- `BUDDY_SUPABASE_PUBLISHABLE_KEY`

Vercel runs `npm run build` and publishes `dist/`. After assigning the production domain, add it under Supabase **Authentication → URL Configuration** as the Site URL and add the required confirmation and redirect URLs. Do not add a Supabase secret or service-role key to Vercel's browser-facing build variables.

## Security

- Never commit `.env.local`, access tokens, private keys, or Supabase secret/service-role keys.
- The browser uses only the Supabase publishable key. It is visible to site visitors by design and must be protected by Row Level Security and storage policies.
- Review GitHub history before publishing if credentials were ever committed in earlier revisions. Removing a value from the latest files does not erase it from Git history.
