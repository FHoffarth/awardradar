# Microsoft Clarity Foundation

## Context

AwardRadar is a Flask application using Jinja templates.

Google Analytics currently exists directly in `templates/index.html`.

Google Tag Manager is prepared in:

```text
branch: codex/google-tag-manager-foundation
commit: c9a697e
container: GTM-TBBPLXGV
```

Microsoft Clarity project:

```text
project_id: xc067n2nj5
```

## Architecture Decision

Use Google Tag Manager to deploy Microsoft Clarity.

Do not add the Microsoft Clarity script directly to Flask templates at this stage.

## Rationale

GTM is the cleanest and most maintainable integration point because it keeps third-party analytics tags out of application templates.

This avoids:

- duplicate Clarity initialization
- repeated Flask template edits for analytics changes
- hard-coded future affiliate or ad platform tags
- mixing product UI changes with analytics infrastructure

It also prepares the project for future consent management, where analytics providers can be enabled, disabled, or delayed centrally through GTM.

## Required GTM Configuration

Create a Microsoft Clarity tag in container:

```text
GTM-TBBPLXGV
```

Use the official Microsoft Clarity tracking snippet with project ID:

```text
xc067n2nj5
```

The Clarity snippet must be added inside a GTM Custom HTML tag unless a native Microsoft Clarity tag template is available in the GTM workspace.

## Production-Only Guard

Clarity must load only on production.

Recommended GTM trigger:

```text
Trigger type: Page View
Condition: Page Hostname equals awardradar.app
```

If production later also uses `www.awardradar.app`, add:

```text
Page Hostname equals www.awardradar.app
```

Do not fire Clarity on:

- localhost
- 127.0.0.1
- staging domains
- preview domains
- Railway preview deployments

## Duplicate Initialization Guard

Do not add a second Clarity snippet directly to:

```text
templates/index.html
templates/impressum.html
templates/datenschutz.html
```

There should be exactly one Clarity deployment path:

```text
Google Tag Manager -> Microsoft Clarity
```

## GDPR-Friendly Structure

This foundation does not implement a consent banner.

It prepares for future consent management by centralizing analytics delivery through GTM.

Future consent management should control:

- Google Analytics
- Google Tag Manager-triggered tags
- Microsoft Clarity
- affiliate tracking
- conversion pixels

Until consent management exists, Clarity should remain limited to the production hostname and should not be duplicated in application code.

## Verification Checklist

After GTM configuration and publish:

1. Open `https://awardradar.app`.
2. Verify `GTM-TBBPLXGV` loads.
3. Verify Clarity network requests load only on `awardradar.app`.
4. Verify no Clarity request loads on local or staging environments.
5. Verify Google Analytics still loads.
6. Verify there are no duplicate Clarity script requests.
7. Verify page rendering is unchanged.

## Modified Files

This sprint intentionally modifies documentation only:

```text
docs/microsoft_clarity_foundation.md
```

No product code, UI, API logic, dependencies, secrets, or environment variables are changed.

## Follow-Up Recommendations

1. Merge and verify `codex/google-tag-manager-foundation` first.
2. Configure Clarity inside GTM using project ID `xc067n2nj5`.
3. Publish GTM only after preview verification.
4. Add a future `analytics/consent` architecture document before adding more tags.
5. Keep affiliate tracking and conversion pixels GTM-managed rather than hard-coded in Flask templates.
