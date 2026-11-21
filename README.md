# ORBIT

**Organisation Records & Business Intelligence Toolkit** — a secure, local-first foundation for member records and organisational relationships.

## Current foundation

- Searchable member directory with profile creation and editing.
- Household records with shared addresses and current member links.
- Administrative groups with member assignments.
- Directional relationships between members.
- Date-effective household, group, and person-to-person links.
- Member profile change history, including who made each change.
- Existing administrator sign-in and access controls, reused from the source application.

The initial member profile is intentionally limited to name, preferred name, email, phone, membership status, join date, and notes. No date of birth or other sensitive fields are collected in this first slice.

## Local development

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run setup:local
npm run dev
```

Open <http://localhost:5173>. The default local administrator is `admin@example.com`; set `DEV_ADMIN_EMAIL` in `.dev.vars` to change it. Local email mode is a no-send log mode.

Useful commands:

```bash
npm test
npm run typecheck
npm run build
npm run db:reset:local
```

The app uses React Router Framework Mode, React, TypeScript, Cloudflare Workers, and D1. SQL schema changes belong in a new ordered migration under `migrations/`.

## Deployment is intentionally disabled

This repository was copied from another application. Its original Cloudflare database IDs, domains, and automatic deployment workflow have been removed. The Wrangler database ID is a placeholder and `workers_dev` is disabled.

Before deploying ORBIT, provision a **new** Cloudflare Worker and D1 database, then configure the new resource IDs, administrator authentication, email provider, domains, and deployment workflow. Do not copy production resource IDs or credentials from the source application.

## Push this copy to a new GitHub repository

The current Git remote belongs to the original event-registration project. Do not push cleanup or ORBIT changes to it.

1. Create an empty repository in GitHub, for example `orbit`.
2. Make sure the repository does not have a README, licence, or `.gitignore` that would cause unrelated history conflicts.
3. Remove the old remote and add the new one:

   ```powershell
   git remote remove origin
   git remote add origin https://github.com/YOUR-ORGANISATION/orbit.git
   ```

4. Review the files that will be committed:

   ```powershell
   git status
   git diff --stat
   git diff --check
   ```

5. Commit and push:

   ```powershell
   git add .
   git diff --cached --stat
   git commit -m "Create ORBIT member management foundation"
   git branch -M main
   git push -u origin main
   ```

The source repository will be left as an independent copy. After pushing, enable branch protection and add repository secrets only for the new deployment environment.
