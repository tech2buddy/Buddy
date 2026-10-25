# Mobile refinement — 25 October 2026

## Evidence and interpretation
- Apple HIG Layout: hierarchy, grouping, progressive disclosure, safe areas, and adapting to available space. https://developer.apple.com/design/human-interface-guidelines/layout
- Revolut's current homepage: clear hero promise and primary CTA; user-selectable scenarios for savings. https://www.revolut.com/
- Wise's current homepage: connects product explanations to concrete visitor tasks and foregrounds relevant details. https://wise.com/gb/
- Material bottom sheets: user-triggered supplementary content, dismissal, and avoiding obstruction of other controls. https://m2.material.io/develop/android/components/sheets-bottom/
- Material motion: distinct timing for spatial changes and small state changes. https://m3.material.io/styles/motion/overview/how-it-works

These are design references, not proof of conversion improvements for Buddy Loans. No testimonials, financial terms, or customer statistics were borrowed.

## Applied
- Mobile-specific composition below 761px, keeping the desktop layout.
- Compact sticky navigation, 44px menu/pause targets, 54px primary hero action.
- Centered headline and a 265px illustration instead of stacking a desktop-sized graphic.
- Scenario controls become a compact three-option selector immediately above the result.
- Body and FAQ typography increased to 14–15px; secondary content no longer uses desktop-sized microcopy.
- Native modal dialogs styled as bottom sheets, providing keyboard focus containment and Escape dismissal.
- Contextual bottom action appears after the hero and hides while the closing CTA is visible.
- Safe-area padding, viewport-fit, dynamic viewport units, reduced-motion support.
- Offscreen decorative animations pause; smaller mobile glass layers do not animate.
- Font connections discovered from the HTML head rather than a nested CSS import.

## Scope
This remains a landing-page concept. Applications and product terms await confirmed business requirements. No financial or identity information is collected.
