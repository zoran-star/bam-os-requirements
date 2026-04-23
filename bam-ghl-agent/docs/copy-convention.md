# Copy Convention

> How copy placeholders, custom values, and embed codes work in section HTML.

---

## Three Types of Dynamic Content

### 1. Copy Placeholders — `{{COPY:field_name}}`

These are written by the agent at build time using the Copy Instructions brief.

```html
<h1>{{COPY:headline}}</h1>
<p>{{COPY:subheadline}}</p>
<a href="#">{{COPY:cta_text}}</a>
```

**Rules:**
- Agent reads the Copy Instructions for this section
- Agent writes original copy for every placeholder
- Copy is injected before the HTML is handed to the human
- Final output should have NO `{{COPY:...}}` remaining

**Copy Instructions format (in Notion):**
```
HEADLINE: Speak to the parent. Address fear of athlete plateauing.
Second person ("your athlete"). Max 8 words. Basketball-specific.

SUBHEADLINE: Expand with the outcome after training. Reference
{{custom_values.city}}. 1-2 sentences.

CTA_TEXT: Action verb + specific outcome. Max 5 words.
Examples: "Book your free trial", "Claim your spot"
```

---

### 2. Custom Values — `{{custom_values.key_name}}`

These are set in GHL sub-account settings and resolved at render time. The agent leaves these as-is in the HTML output — the human sets the values in GHL.

```html
<p>Training in {{custom_values.city}} since {{custom_values.founded_year}}</p>
<a href="{{custom_values.booking_link}}">Book now</a>
<img src="{{custom_values.logo_url}}" alt="{{custom_values.business_name}}">
```

**Rules:**
- Agent NEVER replaces custom values with real data
- Always pull key names from TEMPLATE CUSTOM VALUES in Notion
- Never invent key names
- Build checklist must list every custom value that needs to be set

---

### 3. Embed Codes — `<!-- EMBED: [name] -->`

These mark where GHL native items go. The human replaces them with the actual GHL embed code when building.

```html
<!-- EMBED: Free Trial Calendar -->
<!-- EMBED: Player Intake Form -->
```

**Currently supported embeds:**
- `Free Trial Calendar` — the only calendar used
- Any form from TEMPLATE FORMS in Notion

---

## Example Section (Full)

**Input — section record from Notion:**
```
Name: Hero — Sports Academy
Code:
  <section class="hero">
    <h1>{{COPY:headline}}</h1>
    <p>{{COPY:subheadline}}</p>
    <a href="{{custom_values.booking_link}}" class="btn">{{COPY:cta_text}}</a>
    <!-- EMBED: Free Trial Calendar -->
  </section>

Copy Instructions:
  HEADLINE: Second person, parent-focused, fear of plateau,
  basketball-specific, max 8 words.
  SUBHEADLINE: Outcome-focused, mention {{custom_values.city}},
  1-2 sentences.
  CTA_TEXT: Action verb + outcome, max 5 words.

Custom Values: booking_link, city
Items to Embed: Free Trial Calendar
Inputs Required: business_city (from Questions DB)
```

**Output — after agent processes for Elevate Hoops NYC:**
```html
<section class="hero">
  <h1>Where New York athletes stop plateauing</h1>
  <p>Elevate Hoops gives NYC players the elite-level reps and
  position-specific coaching that turn hard work into real results.</p>
  <a href="{{custom_values.booking_link}}" class="btn">Book your free trial</a>
  <!-- EMBED: Free Trial Calendar -->
</section>
```

Human's build checklist from this section:
- [ ] Set `{{custom_values.booking_link}}` in GHL sub-account
- [ ] Replace `<!-- EMBED: Free Trial Calendar -->` with GHL calendar embed code
