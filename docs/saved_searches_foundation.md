# Saved Searches Foundation

## Mission

AwardRadar should gain product memory before user identity.

This foundation enables:

```text
Search -> Save -> Return
```

without accounts, login, email collection, alerts, notifications or background jobs.

## Current Implementation

Saved searches are stored browser-locally in `localStorage` under:

```text
awardradar_saved_searches
```

This is intentional for v1:

- no server-side user identity
- no email address
- no account table
- no database dependency
- no alert execution
- no notification channel

The implementation is a persistence foundation and UX scaffold, not an accounts or alerts system.

## Data Shape

Current fields:

```json
{
  "id": "ss_labc123_xyz789",
  "user_id": null,
  "origin": "FRA",
  "destination": "JFK",
  "departure_date": "2026-08-15",
  "return_date": "",
  "cabin": "Business",
  "programs": ["star_alliance"],
  "passengers": 1,
  "search_type": "awards",
  "flex_days": 0,
  "created_at": "2026-06-25T20:00:00.000Z",
  "updated_at": "2026-06-25T20:00:00.000Z",
  "is_active": true
}
```

The shape is account-ready because `user_id` exists but stays `null` until the privacy and accounts gates are complete.

## Future Account Connection

When accounts are introduced, saved searches can move from browser-local storage to a server-side table with the same conceptual shape:

```text
SavedSearch.user_id -> User.id
```

Migration options:

1. Keep local saved searches local until the user explicitly imports them.
2. On login, ask whether to attach existing browser-local saved searches to the account.
3. Never silently upload saved searches.

Privacy principle:

```text
First privacy. Then identity.
```

## Future Alerts Connection

Alerts should be built on top of saved searches, not mixed into this foundation.

Document-only future fields:

```json
{
  "alert_frequency": "daily",
  "last_checked_at": null,
  "notification_channels": ["email"],
  "traveler_profile_id": null
}
```

Future alert flow:

```text
Saved Search
-> Availability check
-> Decision Engine filter
-> Notification only if relevant
```

Guardrail:

```text
Saved search does not imply alert.
```

## Product Principles

```text
Memory before identity.
Identity before personalization.
Personalization before automation.
Automation before notifications.
```

## Privacy Notes

Saved searches may reveal travel intent. In this foundation they stay in the user's browser and are not sent to AwardRadar as a saved-search record.

The privacy notice documents the `awardradar_saved_searches` localStorage key.

## Non-Goals

- no accounts
- no login
- no email collection
- no alerts
- no background jobs
- no server-side saved-search API
- no traveler profiles
- no notification preferences
