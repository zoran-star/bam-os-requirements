# Client portal: parked items for future sessions (2026-07-16)

Parked by Zoran during the mobile styling session. **These belong in Notion Open Loops but both local Notion tokens 401'd** (whiteboard `.env.production` NOTION_TOKEN + bam-portal `.env.local` NOTION_API_KEY, and this session's Notion MCP had no write tools). Move them there when Notion access is back - and refresh those tokens, the whiteboard one powers push-requirements.mjs / session tooling.

## 1. Top banners: extend triggers + overdue escalation (future session, Medium)
The two top-of-portal banners are rendered client-side on boot from ticket states - nothing "sends" them:
- Yellow "We need something from you" (`_checkActionBanner`): support ticket `status=awaiting_client` OR creative/campaign `client_action_status='requested'`. Staff flipping the status in the staff portal is the real trigger. "Later" = sessionStorage snooze.
- Green "completed while you were away" (`_checkCompletedBanner`): ticket hits `final_review` / request `completed` with `resolved_at` newer than the client's last-seen baseline (localStorage, 14-day cap).

Future session scope (discussed 2026-07-16):
- Extend yellow to: onboarding feedback requested, Meta reconnect needed, unread staff question in ticket chat
- Always ONE banner with a count ("2 things need you"), never stacked
- SMS/email escalation when `awaiting_client` sits unanswered 2-3 days (ties into the pending round-3 "email/SMS ticket notifications" item)

## 2. Scroll-blur effect: re-decide in the dedicated UI pass (Low)
Two scroll-driven blurs existed and only the hero visibly blurred on mobile ("only the first thing blurs"):
- V2 Home hero parallax (`_hmInitParallax`) - blurred `#home-v2 .hv2-hero` with scroll progress
- Command-center section recede (`_ccInitRecede` area, ~line 52899) - blurred whole `cc-sec-*` sections entering the top 30%->6% viewport band

Both `style.filter` blur lines set to `''` on 2026-07-16 (branch claude/mobile-frontend-cloud-test-440qaf); the fade + slide of both effects was KEPT. Both sites carry a "Scroll blur OFF for now" comment. At the UI pass: restore blur consistently across all receding content (keep Cole's "middle of the screen never blurs" rule) or strip the leftover fade/slide too. Note: effects are gated on `prefers-reduced-motion` - test on a real phone, not the desktop preview.

## 3. Focus overlays sit as mobile bottom-sheets = tall content's top unreachable (Medium, latent)
The Hawkeye mobile deploy (2026-07-16) fixed this for the SALES/Hawkeye overlay only. Root cause: every `.mm-focus-page.modal-backdrop` is a full-page focus overlay (`.mm-modal-card { max-height:none }`) but the base mobile rule `@media(max-width:768px){ .modal-backdrop{ align-items:flex-end } }` pins it as a bottom sheet - so any card taller than the screen has its TOP pushed above the viewport with no way to scroll up (flex overflow above the container start is unreachable). The fix shipped as `#salesMachineModal.mm-focus-page.modal-backdrop { align-items:flex-start; overflow-y:auto }` (client-portal.html ~line 4057), **deliberately scoped to salesMachineModal** to avoid silently changing untested surfaces in a hotfix.

The SAME latent bug still affects the other 6 focus overlays (all `class="modal-backdrop mm-focus-page"` in markup - members machine, marketing/growth machine, blueprint, calendar `cal-focus-page`, + 2 more). None reported broken yet (their content usually fits), but a tall card would trap the top on mobile. Dedicated fix: promote the scoped rule to all `.mm-focus-page.modal-backdrop` after verifying each overlay on a phone (esp. the Shield members focus from PR #1471 which now has KPIs/Actions left-pages).
