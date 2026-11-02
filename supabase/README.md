# Supabase setup foundation

The Buddy Loans website is a static site backed by Supabase Auth and database functions. Students can save and submit applications, upload documents privately, and follow updates. Staff review is manual. The system does not automatically scan documents, assess affordability, execute a debit order, or transfer funds.

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

### Written offers, mandate authorization and payout tracking

After all four latest documents are accepted and an operations admin approves an application, the owner or operations admin can issue a written offer from the application detail. The offer uses the recorded disbursement history to select the first-loan (5%) or repeat-loan (3%) interest rate, applies the 15% initiation fee, and uses a service fee of 20% (first loan) or 22% (repeat loan), capped at R60. The student sees the itemized offer in Activity and must explicitly accept it before authorizing a debit order.

Before enabling this workflow, apply `migrations/202611020001_buddy_offer_mandate_flow.sql` after all prerequisites above, including `202611010006_buddy_admin_user_management.sql`. This migration adds student-owned offer visibility and audited, role-checked RPCs for offer issue, acceptance, provider-reference review, and recording a completed payout. It does not integrate a mandate provider or initiate collection or bank transfer. Staff must use a provider approved by Buddy, give the student that provider's secure authorization link, independently verify provider confirmation, and record payout only after it has actually been sent. Never extract or copy account numbers from bank statements into Buddy. The student submits a provider confirmation reference; it remains unverified until staff check it with the provider. A real provider integration and its operational/legal approval are still required before automated mandates or collections can run.

## Deliberate boundaries

- Do not enable automated borrowing, credit-bureau checks, affordability decisions, debit-order collection, or bank transfers through this website until the agreements, fee rules, trusted providers and operational controls are ready. The written-offer workflow is for manual staff and provider handling only.
- Do not treat uploaded files or user-entered metadata as verified evidence. Validate file content server-side before any processing.
- Uploading a document does not apply for a loan or start an AI assessment. Do not manually open/process uploaded documents until staff access, privacy and review procedures are approved.
- The browser may use only the project URL plus its publishable/anon key. Elevated keys belong only in trusted server-side functions.

## Sources

- [Supabase frontend security and Row Level Security](https://supabase.com/docs/guides/database/secure-data)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase API key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
