# Section Templates

This folder contains the HTML source for each reusable section template.

Each file here should mirror a record in the TEMPLATE SECTIONS Notion database.
The Notion record is the source of truth — this folder is for version control and
easier editing before syncing back to Notion.

## File naming convention

```
[section-type]--[name].html
```

Examples:
```
hero--sports-academy.html
social-proof--testimonials-grid.html
cta--book-trial.html
features--program-tiers.html
faq--general.html
form-section--booking.html
```

## File structure

Each section file should include a header comment block:

```html
<!--
  SECTION: Hero — Sports Academy
  TYPE: Hero
  PAGE TYPES: Home, Landing Page
  POSITION: Top
  TRYING TO COMMUNICATE: First impression — outcome, identity, CTA
  CUSTOM VALUES: booking_link, city, business_name
  ITEMS TO EMBED: Free Trial Calendar
  INPUTS REQUIRED: business_city, program_type
-->

<section class="hero">
  <h1>{{COPY:headline}}</h1>
  <p>{{COPY:subheadline}}</p>
  <a href="{{custom_values.booking_link}}">{{COPY:cta_text}}</a>
  <!-- EMBED: Free Trial Calendar -->
</section>
```

## Copy Instructions

Each section file should have a corresponding `.instructions.md` file:

```
hero--sports-academy.instructions.md
```

This keeps the copy brief separate from the HTML for easier editing.

## Status

No sections populated yet — this is the next major build task.

Priority sections to build first:
1. hero--sports-academy
2. social-proof--stats-bar
3. cta--book-trial
4. features--program-tiers
5. testimonials--parent-quotes
6. form-section--booking
7. faq--general
8. nav--main
9. footer--main
