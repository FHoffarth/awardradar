# Awards API Triage

Date: 2026-06-24

Branch: `codex/awards-api-triage`

## Scope

Read-only diagnosis of production behavior for:

```text
POST https://awardradar.app/api/awards
```

No product code, UI, booking logic, GTM changes, secrets, or environment variables were changed.

## Initial Symptom

The production smoke test did not complete successfully for `/api/awards`.

Observed outcomes during triage:

- Existing smoke test timed out during the awards check.
- Some `curl.exe` attempts returned `500 {"error":"analysis_unavailable","ok":false}` because PowerShell/curl quoting produced unreliable JSON request bodies.
- A correctly serialized Python `urllib` request with a longer timeout returned `200`.

## Reproduction

Valid request payload:

```json
{
  "origin": "FRA",
  "dest": "JFK",
  "cabin": "Business",
  "date": "2026-08-15"
}
```

Result with Python `urllib` and a 70 second timeout:

```text
HTTP 200
elapsed: ~45.6s
ok: true
has_live_data: true
cash_eur: null
note: Real-time award availability · Verify before booking
```

Control request with missing origin:

```json
{
  "origin": "",
  "dest": "JFK",
  "cabin": "Business",
  "date": "2026-08-15"
}
```

Result:

```text
HTTP 400
ok: false
error: Bitte Start und Ziel eingeben, z. B. Frankfurt und Tokio.
```

This confirms that request parsing and route dispatch are working when the JSON body is valid.

## Findings

Production health at time of triage:

```json
{
  "ok": true,
  "price_source": "serpapi",
  "award_source": "seatsaero",
  "serpapi_token": true,
  "seatsaero_key": true,
  "seatsaero_remaining": 161
}
```

The successful awards response had:

```text
has_live_data: true
cash_eur: null
```

That points to this likely path:

1. `/api/awards` receives a valid request.
2. `fetch_cash_details()` calls SerpApi / Google Flights for cash details.
3. The cash lookup is slow or returns no usable fare.
4. `fetch_cash_details()` falls back to `{}` after its timeout/error handling.
5. seats.aero live availability still returns usable rows.
6. AwardRadar returns a valid award response, but only after the slow cash lookup path.

## Root Cause Assessment

The endpoint is not consistently hard-failing for valid JSON.

The immediate production issue is high latency in the `/api/awards` path, likely caused by the cash-price lookup before seats.aero / estimated award results are returned.

The smoke test timeout is too close to the current worst-case production latency.

## Non-Causes

- Not a GTM issue.
- Not a UI issue.
- Not a seats.aero quota exhaustion issue; `seatsaero_remaining` was 161.
- Not a complete request parsing failure; invalid/missing inputs return structured 400 responses.
- Not a guaranteed awards analysis crash; valid JSON can return 200 with live data.

## Minimal Fix Options

Do not implement these in an analytics or GTM branch.

Potential low-risk follow-up options:

1. Increase the production smoke test timeout for `/api/awards` to at least 75 seconds.
2. Add elapsed-time logging around:
   - `fetch_cash_details()`
   - `fetch_seatsaero()`
   - `build_seatsaero_programs()`
3. Consider a bounded fast-fail for cash details in `/api/awards`, because award availability can still be useful without cash comparison.
4. Consider returning live award results first and treating cash comparison as optional when SerpApi is slow.

Options 3 and 4 affect product behavior and should receive lead review before implementation.

## Recommendation

For immediate workflow:

```text
GTM branch remains merge-ready after normal review.
Awards API latency should be tracked as a separate performance triage item.
```

For the smoke test:

```text
Increase /api/awards timeout before using it as a hard production gate.
```
