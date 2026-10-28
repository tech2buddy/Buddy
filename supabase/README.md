# Supabase setup foundation

The current Buddy Loans website is a static site. The dashboard journey is client-side guidance and does not create an account, save an application, request a credit check, or submit a loan. Do not enable uploads until Supabase is connected and the required privacy, retention, access-review and regulatory decisions are complete.

## Connect a project

1. Create or select the Buddy Loans Supabase project.
2. Share its **Project URL** and **publishable key** (or legacy `anon` key) to wire up browser auth. These are intended for client applications, but access still depends on correctly configured policies.
3. Never provide or place a `service_role` / `sb_secret_...` key in browser code, the static site, or a committed file.
4. Confirm the allowed university email domains or the authoritative way to verify a student's university email. A generic `.ac.za` suffix is not proof of current registration.
5. Configure email verification and approved redirect URLs for the production domain.
6. Review and apply `migrations/202610280001_private_student_documents.sql` to that project. It creates a private bucket with per-user folder isolation and 10 MiB PDF/JPEG/PNG limits. It does not create application records or a document-review workflow.
7. Before collecting IDs, proof of residence, registration evidence or bank statements, approve the privacy notice, consent, retention/deletion schedule, staff access controls and incident procedure. Keep files private and use short-lived signed links only when a verified reviewer needs access.

## Deliberate boundaries

- Do not enable real borrowing, pricing, credit-bureau checks, affordability decisions, or debit-order mandates through this website until the relevant NCR registration, agreements, fee rules and third-party integrations have been reviewed and approved.
- Do not treat uploaded files or user-entered metadata as verified evidence. Validate file content server-side before any processing.
- The browser may use only the project URL plus its publishable/anon key. Elevated keys belong only in trusted server-side functions.

## Sources

- [Supabase frontend security and Row Level Security](https://supabase.com/docs/guides/database/secure-data)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
