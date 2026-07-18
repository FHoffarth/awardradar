# AwardRadar Deployment Governance

Last updated: 2026-07-18

This document records the verified release model for AwardRadar. It complements
the canonical repository state, but Git alone does not prove live deployment
state.

## Branch model

- `main`
  - canonical integration branch
  - may contain code not yet released to Production
  - pushing to `main` does not publish Production

- `staging`
  - pre-production deployment branch
  - Railway Staging auto-deploys from this branch
  - moving `staging` requires explicit staging approval in the active workflow

## Verified Railway mapping

Presently verified state as of 2026-07-18:

- Production
  - Railway project: `outstanding-solace`
  - environment: `production`
  - service: `web`
  - source repository: `FHoffarth/awardradar`
  - source branch: `main`
  - auto-deploy: disabled
  - current verified deployed commit: `536e0b23665c2a36ec504dad928a9f79a9715799`
  - domain: `https://awardradar.app/`

- Staging
  - environment: `relative-cash-staging`
  - service: `web`
  - source branch: `staging`
  - auto-deploy: enabled
  - current verified deployed commit: `536e0b23665c2a36ec504dad928a9f79a9715799`
  - domain: `https://web-relative-cash-staging.up.railway.app/`

These commit values are historical verification evidence, not a permanent rule.

## Production rule

Push to `main` does not equal Production release.

Production deployment requires:

1. reviewed commit on `main`
2. successful Staging deployment and smoke
3. explicit fresh `PRODUCTION GO`
4. intentional manual Railway Production deployment
5. post-deploy Production verification

Railway Production remains connected to `main`, but Production auto-deploy is
disabled. No standing or implied approval carries over from an earlier release.

## Release flow

1. implement and review
2. explicit `COMMIT GO`
3. create the commit
4. explicit `PUSH GO`
5. push the approved commit to `main`
6. explicit `STAGING FAST-FORWARD GO`
7. fast-forward `staging` to the approved commit
8. Staging auto-deploy and focused smoke
9. fresh explicit `PRODUCTION GO`
10. manual Railway Production deployment of the approved commit
11. focused Production verification

## Evidence rules

Always distinguish between these states:

- committed
- pushed to `main`
- pushed to `staging`
- deployed to Staging
- verified on Staging
- deployed to Production
- verified on Production

Evidence rules:

- Git SHA alone does not prove Railway deployment.
- Railway deployment metadata is preferred evidence.
- Live asset identity is supporting evidence only.
- Never say “live” without direct Production evidence.
- Never say “Production safe” without a post-deploy smoke.

## Approval gates

Use these approval gates exactly:

- `COMMIT GO`
- `PUSH GO`
- `STAGING FAST-FORWARD GO`
- `PRODUCTION GO`

Each approval applies only to the immediate scoped action.
Approval never carries over to a later commit or release.

## Conservative rollback procedure

1. identify the prior known-good Production deployment or commit
2. obtain explicit rollback approval from Florian
3. manually redeploy the prior known-good version in Railway
4. verify routes, assets, health, and the affected behavior
5. document the rollback result

This document does not claim a one-click rollback exists.
