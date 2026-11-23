# Production operations and data lifecycle

This is an operational starting point, not a legal retention policy. The production Cloudflare resources have not been provisioned. Do not deploy the development configuration as production: `wrangler.jsonc` contains a placeholder D1 ID and `workers_dev` is disabled.

## Current safeguards

- GitHub Actions runs typecheck, tests, and the production build on pushes and pull requests to `main`.
- Worker observability is enabled. The application worker's five-minute schedule creates approval reminders and processes approved email only when the delivery gate is configured.
- The separate backup worker configuration schedules one backup run per day at 02:17 UTC. It stores a D1 SQL export and a copy of generated documents under the same timestamped prefix.

## Provisioning checklist

Create new production resources in the intended Cloudflare account; do not reuse resources or IDs from another application:

1. Create a production D1 database, the application documents R2 bucket, and a separate private `orbit-backups` R2 bucket.
2. Create and review a production configuration separate from local `wrangler.jsonc`; set the new D1 ID, documents bucket, `APP_ENV=production`, and delivery disabled by default. Confirm the application documents bucket name matches `wrangler.backup.jsonc`.
3. Configure the backup worker's `CLOUDFLARE_ACCOUNT_ID` and `ORBIT_PRODUCTION_DATABASE_ID` variables, and add `D1_BACKUP_API_TOKEN` as a Worker secret with permission to export that D1 database. Keep the token out of configuration files and logs.
4. Configure the backup bucket's lifecycle rule so objects under the `daily/` prefix expire after 30 days:

   ```sh
   npx wrangler r2 bucket lifecycle add orbit-backups daily-retention daily/ --expire-days 30
   ```

   R2 lifecycle expiration may take up to 24 hours to remove expired objects.

5. Deploy the application and backup worker only after reviewing the resource bindings and production secrets:

   ```sh
   npx wrangler deploy --config wrangler.production.jsonc
   npx wrangler deploy --config wrangler.backup.jsonc
   ```

   Keep the backup bucket private and do not attach a public domain. The backup contains member information, financial records, and generated PDFs.

The scheduled backup will not work until the account ID, database ID, export token, and both R2 buckets are configured. Do not put credentials in the repository or chat.

## Administrator access model

- `SUPER_ADMIN` is the organization-wide administrator role and can manage administrator access.
- Role-based administrators can hold multiple bundles: Membership, Finance, Communications, Document preparer, Approver, and Privacy. Server middleware protects each admin area; approval decisions are restricted to Approvers, not document preparers.
- Member exports/imports, recipient exports, approved PDF downloads, and personal-data ZIP exports are separate sensitive permissions managed alongside the role bundles.
- Departments and commissions can be recorded for organizational membership, but they do not grant permissions or scope which records an administrator can see.
- Existing `ADMIN` accounts without role assignments retain their previous broad access until a super-administrator assigns at least one permission bundle. New role-based administrator accounts require a bundle. The access page flags remaining legacy accounts.
- These are module-level controls, not field-level redaction. For example, access to the member module includes the personal fields displayed by member profiles; review the data exposed by each module before assigning its role.

## Backup and recovery

- The backup workflow exports D1 and copies every object in the documents bucket to a timestamped `daily/` prefix in the separate backup bucket.
- The 30-day R2 lifecycle rule is necessary to enforce the selected retention period. Confirm it is active after provisioning.
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is always enabled on supported production databases; its recovery window is 7 days on the Workers Free plan and 30 days on the Workers Paid plan. It complements, but does not replace, the daily exports and PDF copies.
- Before real member data is introduced, perform a recovery drill into new, non-production D1 and R2 resources. Import a daily SQL export into a fresh D1 database and restore sample generated PDFs into a fresh bucket. Validate that the records and PDFs open before considering the backup process proven.
- D1 Time Travel restore overwrites the target database and does not currently clone it. Never test a restore against the live database. For an incident, preserve the current state, identify and validate the restore point, obtain explicit approval before any in-place restore, and plan a production cutover.
- The workflow follows Cloudflare's [D1-to-R2 backup pattern](https://developers.cloudflare.com/workflows/examples/backup-d1/); R2 expiration is configured with [object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
- Restrict access to both production and backup resources. A backup is another copy of sensitive data, not a deletion or anonymization mechanism.

## Interim privacy and retention procedure

- Archived member profiles remain stored and can be restored. Archiving is not erasure.
- Do not automatically delete archived member profiles, contribution/payment records, or audit history. Review each retention or erasure request manually until the organization approves a documented retention schedule.
- For an erasure request, verify the request, identify records that may need to be retained for accounting or other obligations, record the decision, and remove or anonymize only the data approved for removal. The application currently has no hard-delete workflow.
- Explain that a deletion from the live database may remain in protected backups until their 30-day expiry; do not promise immediate erasure from backup copies.
- Treat member exports, SQL backups, and generated PDFs as sensitive data. Limit access and remove working copies when no longer needed.
- Record member requests from the member profile in the admin privacy-request register. Set response targets according to the organization's approved procedure; ORBIT does not calculate legal deadlines.
- Personal-data ZIP exports are available only for verified access or portability cases. They include a review warning because household records, message content, notes, and documents may contain information about other people. An administrator must review the package before sharing it; ORBIT does not send it to the requester.
- Privacy-request cases and export actions are audited. No request-record retention period is automated; include these cases in the organization's approved retention schedule.

## Monitoring

Check Cloudflare Worker observability and Workflow instance status after deployment. A failed backup logs an error and rethrows so the Workflow run is marked failed. No notification recipient or external alerting channel is configured yet; assign an owner to review failed runs and perform periodic restore drills.
