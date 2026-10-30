# Supabase setup foundation

The current Buddy Loans website is a static site. Supabase Auth provides verified SPU email sign-up and login; the dashboard journey remains guidance and does not save loan applications, request credit checks, or submit a loan. Do not enable uploads until the required privacy, retention, access-review and regulatory decisions are complete.

## Connect a project

1. Use the Buddy Loans Supabase project. Its Project URL and publishable key may be used by the browser client; the publishable key is not a secret.
2. Never put a `service_role` / `sb_secret_...` key in browser code, the static site, or a committed file.
3. Run `migrations/202610300001_restrict_signup_to_spu.sql` in the Supabase SQL Editor as the project owner.
4. Run `migrations/202610300002_private_student_profiles.sql` in the Supabase SQL Editor as the project owner before enabling first-login profile onboarding. It creates the private `profiles` table; row-level security restricts each student to their own record.
5. Run `migrations/202610300003_profile_preferences.sql` to store the student's preferred contact method and optional product-update choice.
6. In **Authentication → Hooks**, enable **Before User Created** and select `public.buddy_before_user_created`. This server-side hook limits account creation to `@spu.ac.za`; the browser must not be the only domain check.
7. Set the Auth **Site URL** to `https://buddy-loans-first-look-2026.greyhen10.chatgpt.site` and add `https://buddy-loans-first-look-2026.greyhen10.chatgpt.site/**` to the allowed redirect URLs. Keep email confirmation enabled and set the minimum password length to 12 characters.
8. An `@spu.ac.za` address is not proof of current registration; staff may share the domain. Verify registration separately before any lending application.
9. Review and apply `migrations/202610280001_private_student_documents.sql` only after privacy, consent, retention/deletion, staff access controls and incident procedures are approved. It creates a private bucket with per-user folder isolation and 10 MiB PDF/JPEG/PNG limits; it does not create application records or a document-review workflow.

## Deliberate boundaries

- Do not enable real borrowing, pricing, credit-bureau checks, affordability decisions, or debit-order mandates through this website until the relevant NCR registration, agreements, fee rules and third-party integrations have been reviewed and approved.
- Do not treat uploaded files or user-entered metadata as verified evidence. Validate file content server-side before any processing.
- The browser may use only the project URL plus its publishable/anon key. Elevated keys belong only in trusted server-side functions.

## Sources

- [Supabase frontend security and Row Level Security](https://supabase.com/docs/guides/database/secure-data)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
