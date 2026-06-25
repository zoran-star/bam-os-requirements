-- Local development seed: BAM GTA Business Blueprint offers mirrored from prod
-- on 2026-06-24. This keeps local Offer/pricing lineage close to the linked
-- project while parent V1 runtime tables remain independently seeded.

insert into public.offers (
  id,
  client_id,
  type,
  title,
  status,
  data,
  sort_order,
  created_at,
  updated_at
)
values
  (
    '52a6285c-7832-44e1-b531-ab7ef9d8fc21',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'training',
    'Training',
    'published',
    $json$
    {
      "general_info": {
        "description": "Regular training",
        "gender": ["Girls", "Boys"],
        "location": "615bce97-31d2-401e-8314-c07312b917f0",
        "skill_level": "All"
      },
      "ghosted_workflow": "3cc4d142-975c-4f85-ad10-c0dc991fead5",
      "lead_tag": "lead2",
      "lead_tags": ["lead2", "free trial booked", "free trial form filled", "lead free session form"],
      "missed_trial_workflow": "e361a9d4-af13-4154-8b3a-0ef8661e7514",
      "onboarding": {
        "extra_notes": "",
        "intake_form_fields": ["Anything else (custom)"]
      },
      "pricing": {
        "pricing_model": "Membership",
        "pricing_offerings": [
          {
            "added_fees": "13% HST",
            "archived": true,
            "billing_cycle": "every 4 weeks",
            "commitments": [
              {"added_fees": "13% HST", "after": "Goes back to monthly", "length": "12 Weeks (3 Months)", "price": "540", "tax_amount": "13"},
              {"added_fees": "13% HST", "after": "Goes back to monthly", "length": "24 Weeks (6 Months)", "price": "1000", "tax_amount": "130"}
            ],
            "price": "200",
            "title": "Steady",
            "type": "Membership",
            "whats_included": "1 training/wk"
          },
          {
            "added_fees": "13% HST",
            "archived": true,
            "billing_cycle": "every 4 weeks",
            "commitments": [
              {"added_fees": "13% HST", "after": "Goes back to monthly", "length": "12 Weeks (3 Months)", "price": "756", "tax_amount": "13"},
              {"added_fees": "13% HST", "after": "Goes back to monthly", "length": "24 Weeks (6 Months)", "price": "1400"}
            ],
            "price": "280",
            "title": "Accelerate",
            "type": "Membership"
          },
          {
            "added_fees": "13% HST",
            "archived": true,
            "billing_cycle": "every 4 weeks",
            "commitments": [
              {"added_fees": "13% HST", "after": "Goes back to monthly", "length": "12 Weeks (3 Months)", "price": "904.50"},
              {"added_fees": "13% HST", "after": "Goes back to monthly", "length": "24 Weeks (6 Months)", "price": "1675"}
            ],
            "price": "335",
            "title": "Elevate",
            "type": "Membership"
          },
          {
            "added_fees": "13% HST",
            "archived": true,
            "billing_cycle": "4 Weeks",
            "commitments": [
              {"added_fees": "13% HST", "after": "Goes back to monthly", "length": "12 Weeks (3 Months)", "price": "1525.50"},
              {"added_fees": "13% HST", "after": "Goes back to monthly", "length": "24 Weeks (6 Months)", "price": "2825"}
            ],
            "price": "565",
            "title": "Dominate",
            "type": "Membership"
          },
          {
            "archived": true,
            "commitments": [
              {"after": "Other", "after_other": "sdfsdf", "length": "3 month"}
            ],
            "title": "test",
            "type": "Other"
          },
          {
            "added_fees": "13%",
            "added_fees_description": "HST",
            "billing_cycle": "every 4 weeks",
            "commitments": [
              {
                "added_fees": "13%",
                "added_fees_description": "HST",
                "after": "Goes back to monthly",
                "length": "3 Months",
                "price": "753",
                "whats_included": "10% discount to unlimited credits "
              }
            ],
            "price": "279",
            "title": "Summer Unlimited",
            "type": "Membership",
            "whats_included": "Unlimited credits to train"
          },
          {}
        ],
        "pricing_tiers": [
          {"amount": "200", "cycle": "4 sessions/mo", "name": "Steady"},
          {}
        ]
      },
      "sales": {
        "info_collect": [
          "Proximity to location",
          "Experience level (Beg/Int/Adv)",
          "Desired start date",
          "School / grade",
          "Position",
          "Goals"
        ],
        "info_collect_custom": [{}, {}],
        "sales_path": "Free trial",
        "signup_url": "byanymeanstoronto.ca/enroll",
        "trial_duration_price": "1 hour for free",
        "upsells": []
      },
      "schedule": {
        "classes": [
          {
            "age": "Elementary School",
            "consistent": "Yes",
            "gender": ["Boys", "Girls"],
            "skill_level": "All",
            "title": "Group 1",
            "weekly_times": [
              {"days": ["Mon", "Tue", "Thu", "Wed"], "end": "20:00", "location": "615bce97-31d2-401e-8314-c07312b917f0", "start": "19:00"},
              {"days": ["Sat"], "end": "12:30", "location": "615bce97-31d2-401e-8314-c07312b917f0", "start": "11:30"}
            ]
          },
          {
            "age": "High School",
            "consistent": "Yes",
            "gender": ["Boys", "Girls"],
            "skill_level": "All",
            "title": "Group 2",
            "weekly_times": [
              {"days": ["Mon", "Tue", "Wed", "Thu"], "end": "21:00", "location": "615bce97-31d2-401e-8314-c07312b917f0", "start": "20:00"},
              {"days": ["Sat"], "end": "13:30", "location": "615bce97-31d2-401e-8314-c07312b917f0", "start": "12:30"}
            ]
          }
        ],
        "consistent": "Yes",
        "groups": [
          {
            "age": "elementary school",
            "consistent": "Yes",
            "gender": ["Boys"],
            "skill_level": "Beginner",
            "weekly_times": [
              {"day": "Mon", "days": ["Mon", "Tue", "Wed", "Thu"], "end": "20:00", "location": "615bce97-31d2-401e-8314-c07312b917f0", "start": "19:00"},
              {"days": ["Sat"], "end": "12:30", "location": "615bce97-31d2-401e-8314-c07312b917f0", "start": "11:30"}
            ]
          }
        ],
        "weekly_schedule": [
          {"day": "Mon", "end": "20:00", "location": "linbrook", "start": "19:00"},
          {}
        ],
        "year_round": "Seasonal"
      },
      "signup_url": "http://byanymeanstoronto.ca/enroll",
      "value": {
        "program_structure": "Just skills training.",
        "what_makes_different": "We use the most optimal methods, and our culture helps athletes grow off the court too."
      }
    }
    $json$::jsonb,
    0,
    '2026-05-25 18:14:29.614321+00'::timestamptz,
    '2026-06-23 13:50:12.905358+00'::timestamptz
  ),
  (
    'a7dff382-4a4d-45fb-b781-5f6ca2de5cce',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'team',
    '(untitled)',
    'archived',
    '{}'::jsonb,
    0,
    '2026-05-26 14:40:31.448733+00'::timestamptz,
    '2026-06-18 18:29:20.576876+00'::timestamptz
  ),
  (
    'b3b17eff-6112-4f90-b698-5bde3fa354b7',
    '39875f07-0a4b-4429-a201-2249bc1f24df',
    'team',
    '(untitled)',
    'archived',
    '{}'::jsonb,
    0,
    '2026-05-31 18:29:41.34321+00'::timestamptz,
    '2026-06-18 18:29:22.873949+00'::timestamptz
  )
on conflict (id) do update set
  client_id = excluded.client_id,
  type = excluded.type,
  title = excluded.title,
  status = excluded.status,
  data = excluded.data,
  sort_order = excluded.sort_order,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;

insert into public.offer_teams (
  id,
  offer_id,
  title,
  data,
  sort_order,
  created_at,
  updated_at
)
values
  (
    '69049b67-ebc3-470e-aa38-e89e5fdb3cde',
    'a7dff382-4a4d-45fb-b781-5f6ca2de5cce',
    '(untitled team)',
    '{"tryouts":"Yes","consistent":"Yes","home_locations":"","assistant_coaches":"","practice_schedule":"kjh"}'::jsonb,
    0,
    '2026-05-26 14:40:40.911658+00'::timestamptz,
    '2026-05-26 14:43:47.640879+00'::timestamptz
  ),
  (
    '79734a4a-a906-4a69-b6f3-e911a2c60486',
    'a7dff382-4a4d-45fb-b781-5f6ca2de5cce',
    '(untitled team)',
    '{}'::jsonb,
    1,
    '2026-05-26 14:43:22.469611+00'::timestamptz,
    '2026-05-26 14:43:22.469611+00'::timestamptz
  )
on conflict (id) do update set
  offer_id = excluded.offer_id,
  title = excluded.title,
  data = excluded.data,
  sort_order = excluded.sort_order,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
