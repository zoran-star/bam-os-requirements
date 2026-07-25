# Client portal z-index bands (client-portal.html)

`public/client-portal.html` is one giant file with modals written years apart, so
**z-index is the #1 cause of "the button does nothing" bugs.** A modal that mounts
below an open surface renders behind a full-screen backdrop: invisible AND
unclickable, with no console error.

## The bands (2026-07-25)

| Surface | z-index |
|---|---|
| Misc page chrome / older modals | 80 - 3000 |
| Member drawer backdrop | 8900 |
| Member drawer | 8950 |
| Members focus chat (command center) | 9999 |
| Member price modal | 10000 / 10001 |
| Setup-billing modal | 10001 / 10002 |
| Member drawer, **elevated** mode (`opts.elevated`) | 10055 / 10060 |
| **Payment link modal** | **10300 / 10301** |
| `_plToast` | 10400 |

## Rules

- **Any modal launched FROM the member drawer must be above 10060**, not just
  above 8950 - the drawer opens elevated when it sits beside the focus chat.
- **Mount on `document.body`, not `#member-modal-host`.** `openMemberPopup()` does
  `host.innerHTML = ...`, which silently deletes anything else parked in that host.
- Toasts live above everything (10400) so progress text survives an open modal.

## How this bit us

The payment-link send modal was written at z 80/81 back when the drawer was lower.
The drawer later moved to 8900/8950, so **"Payment link" looked completely dead for
months** - the modal opened underneath the drawer's dark backdrop every single time.
Fixed 2026-07-25 (PR #1593). See [[project_member_management_portal]].
