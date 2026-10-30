# Supabase setup foundation

The current Buddy Loans website is a static site. Supabase Auth provides verified SPU email sign-up and login. The dashboard can store student documents privately, but it does not scan or assess them, save loan applications, request credit checks, or submit a loan.

## Connect a project

1. Use the Buddy Loans Supabase project. Its Project URL and publishable key may be used by the browser client; the publishable key is not a secret.
2. Never put a `service_role` / `sb_secret_...` key in browser code, the static site, or a committed file.
3. Run `migrations/202610300001_restrict_signup_to_spu.sql` in the Supabase SQL Editor as the project owner.
4. Run `migrations/202610300002_private_student_profiles.sql` in the Supabase SQL Editor as the project owner before enabling first-login profile onboarding. It creates the private `profiles` table; row-level security restricts each student to their own record.
5. Run `migrations/202610300003_profile_preferences.sql` to store the student's preferred contact method and optional product-update choice.
6. In **Authentication → Hooks**, enable **Before User Created** and select `public.buddy_before_user_created`. This server-side hook limits account creation to `@spu.ac.za`; the browser must not be the only domain check.
7. Set the Auth **Site URL** to `https://buddy-loans-first-look-2026.greyhen10.chatgpt.site` and add `https://buddy-loans-first-look-2026.greyhen10.chatgpt.site/**` to the allowed redirect URLs. Keep email confirmation enabled and set the minimum password length to 12 characters.
8. An `@spu.ac.za` address is not proof of current registration; staff may share the domain. Verify registration separately before any lending application.
9. Apply `migrations/202610300004_secure_student_document_uploads.sql` in the SQL Editor. It ensures the `student-documents` bucket is private, limits each file to 10 MiB and PDF/JPEG/PNG, and allows authenticated users to insert, list/download and delete only files in their own UUID folder. It intentionally grants no overwrite/update policy. The earlier `202610280001` migration is superseded by this idempotent setup.
10. Apply `migrations/202610300005_student_document_review_status.sql`. It creates per-file statuses. Students can read only their own statuses and submit new files as `pending`; they cannot change review decisions. Existing files are initialized as pending review.
11. Until a staff review screen is built, authorized project owners update statuses in Supabase’s Table Editor. Use `pending`, `reviewing`, `accepted`, or `action_required`; action-required rows need a short, non-sensitive note telling the student what to replace. Set `reviewed_by` and `reviewed_at` for every status other than pending. This does not create an automated review or lending decision.
12. Before inviting students to upload real IDs or bank statements, approve and publish a privacy notice, a retention/deletion schedule, staff access controls and incident procedures. Students can remove their own uploaded files; automated retention/deletion is not implemented.

## Deliberate boundaries

- Do not enable real borrowing, pricing, credit-bureau checks, affordability decisions, or debit-order mandates through this website until the relevant NCR registration, agreements, fee rules and third-party integrations have been reviewed and approved.
- Do not treat uploaded files or user-entered metadata as verified evidence. Validate file content server-side before any processing.
- Uploading a document does not apply for a loan or start an AI assessment. Do not manually open/process uploaded documents until staff access, privacy and review procedures are approved.
- The browser may use only the project URL plus its publishable/anon key. Elevated keys belong only in trusted server-side functions.

## Sources

- [Supabase frontend security and Row Level Security](https://supabase.com/docs/guides/database/secure-data)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
