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
11. Apply `migrations/202610300007_student_applications_activity.sql` and `migrations/202610310002_application_review_confirmation.sql` after their prerequisites. These persist application progress and the final student confirmation at submission.
12. Before inviting students to upload real IDs or bank statements, approve and publish a privacy notice, a retention/deletion schedule, staff access controls and incident procedures. Students can remove their own uploaded files; automated retention/deletion is not implemented.

## Staff operations console

Apply `migrations/202611010001_buddy_admin_console.sql` after all prerequisite migrations above. It adds the `/admin` static operations console, application queues and filters, reviewer claims, student/application detail, audited short-lived document previews, document status review, decision notes, summary counts and a recent admin audit view.

The console uses only the public Supabase publishable key. Database functions verify an owner-provisioned staff role, a verified `aal2` MFA session, and a session age under eight hours on every operation. Staff roles and the append-only application audit log are stored in the unexposed `private` schema. The migration intentionally does not provide a browser-accessible role-management control. Enroll and verify TOTP for the staff Auth account first, then run the commented `insert into private.buddy_admin_memberships` statement in the migration with that staff user’s UUID. Use `application_reviewer` for claimed document review, `operations_admin` for application decisions, or `owner_admin` for full operational access. Reviewers must claim a case before seeing full student details or documents. Provision and revoke roles only as the Supabase project owner, and review access regularly.

Application approval records an internal review outcome only; it does not move money, execute a debit order, or issue an offer. The console does not claim to scan files or assess affordability. Disbursement reconciliation, mandate signing, automated document analysis, retention deletion, and messaging integrations require trusted providers and approved procedures before they can run. A manual reviewer must validate files and decisions; do not treat a filename, browser MIME type, university domain, or uploaded statement as verified evidence. Before processing real identity and bank documents, publish and implement a privacy/retention policy and incident response procedure.

## Deliberate boundaries

- Do not enable borrowing, credit-bureau checks, affordability decisions, or debit-order mandates through this website until the agreements, fee rules, trusted providers and operational controls are ready.
- Do not treat uploaded files or user-entered metadata as verified evidence. Validate file content server-side before any processing.
- Uploading a document does not apply for a loan or start an AI assessment. Do not manually open/process uploaded documents until staff access, privacy and review procedures are approved.
- The browser may use only the project URL plus its publishable/anon key. Elevated keys belong only in trusted server-side functions.

## Sources

- [Supabase frontend security and Row Level Security](https://supabase.com/docs/guides/database/secure-data)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
