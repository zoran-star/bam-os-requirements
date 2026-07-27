# Ad requests are invisible to marketing until "Send to Marketing"

**Discovered 2026-07-27** chasing "David A submitted an ad request but Ximena can't see it".
Nothing was broken. This is the designed lifecycle, and it has a visibility hole.

## The flow

```
client submits an ad request (client-portal.html, add-creative / new-campaign)
  -> content_tickets  (channel='ads', assigned to CAM by default)
  -> content team uploads finals, clicks "Send to Marketing"
        -> marketing_tickets  (assigned to the client's SM)  + Slack ping @Ximena
```

Until that handoff there is **no marketing_ticket**, so the marketing executor has
nothing in her queue and gets no DM. The submit-time ping DMs the ads owner (Cam)
only; the rest is a post in `CONTENT_MARKETING_SLACK_CHANNEL`.

## Who sees what

| Surface | Reads | Ximena (`marketing_executor`) |
|---|---|---|
| Marketing tab | `marketing_tickets` (`/api/marketing-tickets`) | her whole world - every message she has ever authored lives here |
| Content tab | `content_tickets` (`/api/marketing?resource=content-tickets`) | she CAN open it, has never used it |

`resolveContentAssignee()` routes ads -> `marketingManagerStaffId()` (Cam, by the
`MARKETING_MANAGER_EMAIL` env / `cameron@byanymeansbusiness.com` lookup) unless
`clients.content_assignee_ads_id` is set. As of 2026-07-27 that roster column is
**null for every client**, so 100% of ads requests land on Cam.

## Why it bites hardest on "boost this post"

`source: 'add-creative'` requests often carry a finished asset (an IG reel link).
There is no content production to do, but the ticket still parks in the content
lane. D.A. Hoops has hit this twice: Jul 9 request reached marketing Jul 16;
Jul 26 request was still sitting when Zoran asked.

## Fix status

Zoran chose **unblock the one ticket** (2026-07-27) and deferred the systemic fix.
Candidates, in the order I'd pick them:

1. Read-only "Incoming - in content" section in the Marketing view: ads-channel
   content tickets with `marketing_ticket_id is null`. Pure visibility.
2. DM the marketing executor on new ads requests too - `marketingExecutorSlackId()`
   already exists in `api/marketing.js`, it is just not called at submit time.
3. Skip content entirely when the client attaches a ready creative to an existing
   campaign. Real lifecycle change, needs a "this is final" signal from the client.

## Manual handoff, if it happens again

`send-to-marketing` is a PATCH on `/api/marketing?resource=content-tickets&id=<id>`
and it 409s unless `final_files` is non-empty. Doing it in SQL means replicating
`spawnOrUpdateMarketingFromContent()` (insert `marketing_tickets` with
`type='add'`, `originated_from_content_ticket_id`, `assigned_to` = the client's
`scaling_manager_id`, then complete the content ticket) - and the Slack ping does
NOT fire, so tell the marketing executor by hand.

Related: [[project_marketing_content_flow]]
