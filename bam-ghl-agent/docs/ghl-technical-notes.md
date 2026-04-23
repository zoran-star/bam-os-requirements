# GHL Technical Notes

> Known quirks, API limitations, and technical decisions for the BAM Business GHL build system.

---

## GHL API

- **Base URL:** `https://services.leadconnectorhq.com`
- **Auth:** Bearer token (API key) + Location ID header
- **Media Storage API:** `POST /medias/upload-file` (multipart/form-data)
- **GHL MCP:** Effectively read-only — use REST API with API key + Location ID for meaningful data access

### Confirmed working via API
- Contact creation/update
- Custom field values
- Tag application
- Pipeline stage movement
- Form submission webhooks

### Not available via API
- Direct site/page publishing
- Media storage automation (requires manual upload or custom pipeline)

---

## GHL Native Embeds

Only two GHL-native items can be embedded in website sections:

1. **Forms** — via GHL embed code (iframe)
2. **Calendars** — only the free trial calendar is currently used

Everything else (payment buttons, membership areas, etc.) is handled outside the section embed system.

**Embed code format in HTML:**
```html
<!-- EMBED: Free Trial Calendar -->
<!-- EMBED: Player Intake Form -->
```

The human builder replaces these comments with the actual GHL embed code when pasting into GHL.

---

## Custom Values

Custom values are set at the sub-account level in GHL and render dynamically in site pages.

**Syntax in HTML:**
```
{{custom_values.key_name}}
```

**Common custom values (from TEMPLATE CUSTOM VALUES in Notion):**
- `{{custom_values.business_name}}`
- `{{custom_values.city}}`
- `{{custom_values.booking_link}}`
- `{{custom_values.phone_number}}`
- `{{custom_values.email}}`
- `{{custom_values.logo_url}}`
- `{{custom_values.primary_color}}`

Always pull the full list from Notion before assuming a key exists.

---

## Mobile Issues (Common)

**Submit button not working on iOS Safari:**
- Most likely: z-index conflict with calendar embed overlay
- Fix: `touch-action: manipulation; position: relative; z-index: 10;` on submit button
- Secondary: Replace `onclick` with `form.addEventListener('submit')`

**Form validation not showing on mobile:**
- Usually CSS overflow/visibility issue on smaller viewports
- Fix: Add explicit error state styling for mobile breakpoints

---

## GHL Site Builder Quirks

- Custom HTML sections accept raw HTML/CSS/JS
- GHL re-wraps content in a container div — don't rely on `body` or `html` selectors
- Fonts load from GHL's CDN — reference by family name only
- `position: fixed` elements can behave unexpectedly inside GHL section containers
- Max recommended section HTML: ~50KB (beyond this can cause editor lag)

---

## Deployment Flow

Current process (human-in-the-loop):
1. Agent outputs HTML per page
2. Human copies HTML into GHL site builder
3. Human replaces `<!-- EMBED: [name] -->` with actual GHL embed codes
4. Human sets custom values in sub-account settings
5. Human activates relevant automations
6. Human verifies on mobile before publishing

Future goal: automate steps 1-5 via GHL API + Make/n8n.

---

## Make / n8n Integration

**Trigger:** GHL webhook fires on form submission
**Flow:**
1. GHL webhook → Make/n8n catches it
2. Make/n8n formats form data
3. HTTP request to Claude API (`POST https://api.anthropic.com/v1/messages`)
4. Claude reads Notion via MCP, generates output
5. Make/n8n routes output to:
   - Notion page (build spec)
   - Slack notification
   - (future) GHL API to set custom values

**Claude API call structure:**
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 8096,
  "system": "[agent-prompt.md content]",
  "messages": [
    {
      "role": "user",
      "content": "[client form responses here]"
    }
  ]
}
```

**Notion MCP in API calls:**
Pass MCP server URL in every API call:
```json
"mcp_servers": [
  {
    "type": "url",
    "url": "https://mcp.notion.com/mcp",
    "name": "notion-mcp"
  }
]
```
