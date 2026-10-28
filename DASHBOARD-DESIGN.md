# Buddy Loans account overview

The home screen is an account summary: loan status first, then the application and repayment facts a student needs, followed by recent updates and one useful next action. It does not behave like a second marketing page.

## Banking patterns adapted for Buddy

- Monzo puts accounts at the top of home and shows recent and upcoming activity directly below. Buddy uses the same scan order, adapted to a student loan: active loan status, application, repayment schedule, and account activity. A savings or cash balance is not shown because Buddy is not a deposit account. Source: [Monzo home screen guide](https://monzo.com/ie/help/using-monzo/help-home-screen).
- FNB describes a personalised snapshot across a customer's products and lets customers choose useful app actions. Buddy keeps the summary focused on one product and prioritises application and repayment details rather than a grid of unrelated bank services. Source: [FNB app overview](https://www.fnb.co.za/ways-to-bank/digital/index.html).
- The account view uses clear labels, compact status cards, and a persistent path to the full activity list. On mobile, the three account facts stack into a single readable column and the most useful action follows the activity summary.

## Account facts and empty state

- No active loan; no repayment is due or scheduled.
- Applications are not open until the required NCR registration and secure account services are ready.
- “Up to R700” is explicitly a planned request ceiling, not an approved credit limit.
- The activity panel explains what will appear there and gives a route to the full activity view.
- The next action is to read the document checklist; the home screen does not imply a user has uploaded or submitted anything.

## Verification boundary

Account balances, loan status, activity and repayment dates must be populated from authenticated, per-user backend records once Supabase is connected. Until then, do not present example customer data as real. Review all fees, privacy and retention rules, student verification, credit checks and collection mandates before opening applications.
