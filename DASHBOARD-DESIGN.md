# Buddy Loans dashboard concept

The dashboard is a mobile-first concept preview. It shows no account, application, loan balance, credit limit, repayment obligation, or credit decision. The amount explorer keeps its state only in the current browser page and displays no estimated interest, fee, or total until pricing is finalised.

## Research translated into the interface

- Monzo places the most relevant current money information and recent activity on its home screen. Buddy's Overview leads with the planned offer, current concept status, and the next useful actions. Source: https://monzo.com/ie/help/using-monzo/help-home-screen
- Monzo's 2026 navigation work separates current needs from longer-term planning. Buddy distinguishes Overview from the Plan amount explorer so the home screen remains focused. Source: https://community.monzo.com/t/we-re-launching-grow-tab-sign-up-for-early-access/190853
- Apple's tab-bar guidance recommends persistent access to a small number of distinct top-level areas, with clear labels and useful empty states. Buddy uses four persistent mobile tabs—Home, Plan, Prepare, Activity—and a matching desktop rail. Source: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Stripe describes dashboards as a place to understand information and take a relevant action. Buddy places an action beside each explanation and avoids a chart with invented account data. Source: https://stripe.com/guides/how-to-surface-business-insights-with-stripe

## Prototype boundaries

Navigation, disclosure panels, and the amount explorer work locally. There is no authentication, document upload, financial assessment, payment integration, or stored customer data. The next implementation phase needs secure identity, verified university email, an approved application flow, and reviewed lending terms.
