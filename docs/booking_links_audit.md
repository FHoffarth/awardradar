# Booking Links Audit

Scope: non-invasive audit of existing AwardRadar booking and verification link generation.

No production behavior, UI, booking logic, secrets, or environment variables were changed.

## Test Route

- Origin: `FRA`
- Destination: `JFK`
- Cabin: `business`
- Date: `2026-08-15`

## Summary

- Strong deep links: United MileagePlus, Air Canada Aeroplan, Singapore KrisFlyer, British Airways Avios
- Fallback-only or homepage links: Miles & More, Flying Blue, Turkish Miles&Smiles, Alaska Mileage Plan, JetBlue
- Need manual verification: none

## Program Booking Links

| Program | Type | Origin | Destination | Date | Cabin | URL | Notes |
|---|---|---:|---:|---:|---:|---|---|
| United MileagePlus | strong deep link | yes | yes | yes | no | https://www.united.com/en/us/fsr/choose-flights?f=FRA&t=JFK&d=2026-08-15&sc=7&tt=1 | Program-owned URL appears to include origin, destination and date. |
| Air Canada Aeroplan | strong deep link | yes | yes | yes | no | https://www.aircanada.com/aeroplan/redeem/flights/search#/results?org0=FRA&dest0=JFK&departureDate0=2026-08-15&ADT=1&YTH=0&CHD=0&INF=0&tripType=O&lang=en-CA | Program-owned URL appears to include origin, destination and date. |
| Singapore KrisFlyer | strong deep link | yes | yes | yes | no | https://www.singaporeair.com/en_UK/ppsclub-krisflyer/kf-plan-redeem/?journeyType=one-way&departureDate=2026-08-15&flightOrigin=FRA&flightDestination=JFK | Program-owned URL appears to include origin, destination and date. |
| British Airways Avios | strong deep link | yes | yes | yes | no | https://www.britishairways.com/travel/redeem/execclub/_gf/en_gb?eId=106001&departurePoint=FRA&destinationPoint=JFK&departureDate=2026-08-15 | Program-owned URL appears to include origin, destination and date. |
| Miles & More | homepage fallback | no | no | no | no | https://www.miles-and-more.com/de/de/award/award-flight.html | Program-owned award page is present, but route/date are not prefilled. |
| Flying Blue | homepage fallback | no | no | no | no | https://www.flyingblue.com/en/spend/flights/award-tickets | Program-owned award page is present, but route/date are not prefilled. |
| Turkish Miles&Smiles | homepage fallback | no | no | no | no | https://www.turkishairlines.com/en-int/miles-and-smiles/award-tickets/ | Program-owned award page is present, but route/date are not prefilled. |
| Alaska Mileage Plan | homepage fallback | no | no | no | no | https://www.alaskaair.com/content/mileage-plan/use-miles/buy-flights | Program-owned award page is present, but route/date are not prefilled. |
| JetBlue | fallback-only | yes | yes | yes | no | https://awardfares.com/search?origin=FRA&destination=JFK&date=2026-08-15 | Falls back to generic AwardFares search, not a program-owned booking link. |

## Verification Links

| Link | Origin | Destination | Date | Cabin | URL | Notes |
|---|---:|---:|---:|---:|---|---|
| AwardFares | yes | yes | yes | yes | https://awardfares.com/search?origin=FRA&destination=JFK&date=2026-08-15&cabin=business | Award availability verification link. |
| seats.aero | yes | yes | yes | yes | https://seats.aero/search?origin=FRA&destination=JFK&date=2026-08-15&cabin=business | Award availability verification link. |
| Google Flights | yes | yes | yes | no | https://www.google.com/travel/flights?q=flights+from+FRA+to+JFK+on+2026-08-15 | Cash comparison link; opens Google Flights query for manual verification. |

## Findings

- United MileagePlus, Air Canada Aeroplan, Singapore KrisFlyer, and British Airways Avios currently produce the strongest route/date-aware deep links.
- Miles & More, Flying Blue, Turkish Miles&Smiles, and Alaska Mileage Plan currently resolve to program-owned award pages without route/date prefill.
- JetBlue is not explicitly mapped in the current booking link generator and falls back to generic AwardFares search.
- AwardFares and seats.aero verification links include route, date, and cabin parameters.
- Google Flights cash comparison includes route and date as a query, but not cabin.

## Expected Manual Behavior

- Deep links should be opened manually to confirm that each provider still accepts the current query parameters.
- Homepage fallbacks are acceptable when providers do not support stable public deep links.
- Generic fallback links should remain clearly distinguishable from program-owned booking links.

## Programs Likely Unable To Support Reliable Deep Links

- Miles & More: public award search often requires session state and login flow.
- Flying Blue: award search flow may depend on session/client routing.
- Turkish Miles&Smiles: award booking flow commonly requires login/session state.
- Alaska Mileage Plan: public deep-link stability for partner awards needs manual verification.
- JetBlue: not currently part of AwardRadar's explicit booking-link map.
