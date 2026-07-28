# E2E Test Plan & Matrix — Relentless AI Web App

This document outlines the End-to-End (E2E) testing plan, test cases matrix, and mocking strategies for Relentless AI's Next.js web application.

---

## 1. Mocking Strategy for External Dependencies

To execute reliable and fast E2E tests (using Playwright or Cypress) without mutating production resources, we intercept network requests or configure a local/mocked mode. Below is the strategy for each external service:

### A. Supabase (Authentication & Local DB)
- **Strategy**: 
  - **Local Emulator**: Run the local Supabase CLI emulator in the test pipeline. This provides real PostgreSQL database schemas, indexes, and row-level security (RLS) policies without hitting the production API.
  - **Auth Mocking**: Use the `@supabase/supabase-js` or `@supabase/ssr` capabilities to sign in with mock users, or inject a JWT session directly into the browser storage/cookies to bypass actual password/OAuth steps in UI-only tests.
  - **Network Interception**: Intercept REST calls (`/rest/v1/*`) and auth calls (`/auth/v1/*`) in standard E2E scripts to mock responses for specific DB failures (e.g., throwing a `42P01` undefined table error during onboarding).

### B. Airtable API
- **Strategy**: Network Interception.
- **Intercept Path**: `https://api.airtable.com/v0/**`
- **Mocks**:
  - `GET /v0/:baseId/tbl_client_profile`: Return a record matching the query `clientId`.
  - `POST /v0/:baseId/tbl_client_profile`: Return `{ id: "recAirtableClient123", fields: { client_id: "client_mocked" } }`.
  - `PATCH /v0/:baseId/tbl_client_profile/:id`: Return status `200` with the updated fields.
  - `GET /v0/:baseId/tbl_daily_scores`, `tbl_biometrics`, `tbl_briefings`, etc.: Return mock arrays of records containing scores, biometrics, news, and briefings (e.g., multi-source sections vs classic text).

### C. GoHighLevel (GHL) API
- **Strategy**: Network Interception.
- **Intercept Path**: `https://services.leadconnectorhq.com/**`
- **Mocks**:
  - `POST /contacts/`: Return status `200` and `{ contact: { id: "ghl_contact_9999" } }`.
  - `POST /contacts/:contactId/tasks`: Return status `200` and `{ task: { id: "ghl_task_888" } }`.
  - `PUT /contacts/:contactId/tasks/:taskId`: Return status `200` with `{ ok: true }`.
  - `DELETE /contacts/:contactId/tasks/:taskId`: Return status `200` or `404` for idempotent deletion.
  - `POST /conversations/messages`: Return status `200` (representing welcome SMS successfully dispatched).

### D. Google Calendar (OAuth & Events Sync)
- **Strategy**: Hybrid OAuth and API Mocking.
- **OAuth Mocking**: In E2E testing, intercept Supabase's `signInWithOAuth` redirect or mock `/auth/callback` to invoke the handler with a mock token query string, ensuring the database profile updates with `google_calendar_refresh_token: "mock_refresh_token"`.
- **Token Exchange**: Intercept `POST https://oauth2.googleapis.com/token` to return a mock `access_token`.
- **Events Retrieval**: Intercept `GET https://www.googleapis.com/calendar/v3/calendars/primary/events` and return a mock event array:
  ```json
  {
    "items": [
      {
        "id": "mock_event_1",
        "summary": "Q3 Board Meeting",
        "start": { "dateTime": "2026-06-27T10:00:00Z" },
        "end": { "dateTime": "2026-06-27T11:00:00Z" }
      }
    ]
  }
  ```

---

## 2. Test Plan Matrix (15 Key Scenarios)

| Scenario ID | Test Flow / Area | Scenario Description | Data Inputs (Inputs/Mock States) | Expected Results | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-01** | **Auth / Sign Up** | Sign Up validation handles bad input gracefully | Email: `invalid-email`, Password: `123`, Confirm: `1234` | Error messages indicating invalid email, password length < 6, and password mismatch are displayed. | **Pass**: All validation errors show; form is blocked.<br>**Fail**: Form submits or crashes. |
| **TC-02** | **Auth / Sign Up** | Successful registration redirects to Consent | Email: `newuser@test.com`, Password: `Password123`, Confirm: `Password123`<br>Supabase mock: Return user session immediately. | Page automatically navigates to `/consent`. Session cookie is active. | **Pass**: URL changes to `/consent` on successful submit.<br>**Fail**: User is stuck on page. |
| **TC-03** | **Auth / Sign In** | Successful email login triggers redirection | Email: `user@test.com`, Password: `Password123`<br>Supabase mock: Authenticate successfully. | User is redirected to `/consent` (and forward to `/onboarding` if previously consented). | **Pass**: Router redirects to `/consent` or `/onboarding`.<br>**Fail**: Errors out or does not route. |
| **TC-04** | **Consent Flow** | User cannot accept policy without reading to end | Load `/consent`<br>Scroll position: top of container. | The checkbox "I agree" is disabled. Text prompts user to scroll to bottom. | **Pass**: Checkbox disabled until scrolled; enabled when scroll target reached.<br>**Fail**: Agree button is clickable immediately. |
| **TC-05** | **Consent Flow** | Accepting policy saves consent to user metadata | Scroll to bottom, click check, click "Agree & continue"<br>Supabase mock: Intercept `updateUser` call. | User metadata in Supabase updates with `consented_at` timestamp. User redirected to `/onboarding`. | **Pass**: Metadata contains `consented_at` and redirect succeeds.<br>**Fail**: Redirect fails or metadata is unmodified. |
| **TC-06** | **Onboarding** | Form rejects invalid phone numbers | Full Name: `Jane Doe`, Phone: `1234`<br>Timezone: `America/New_York` | Validation error "Please enter a valid mobile number (at least 10 digits)" is displayed. | **Pass**: Error message shown; save button fails validation.<br>**Fail**: Form submits short phone number. |
| **TC-07** | **Onboarding** | Form errors out if profiles table doesn't exist | Full Name: `Jane Doe`, Phone: `5551234567`<br>Supabase mock: Fail `upsert` with error code `42P01`. | Specific error message: "Profiles table not found yet. Run the WEB-02 Supabase setup, then try again." | **Pass**: Custom instructions error is shown.<br>**Fail**: Generic error message or crash. |
| **TC-08** | **Onboarding** | Completing onboarding triggers provisioning APIs and dashboard redirect | Full Name: `Jane Doe`, Phone: `5551234567`, Goal: `Increase sales` | Calls `/api/provision` and `/api/profile-sync`, updates database user profile as `onboarded: true`, redirects to `/dashboard`. | **Pass**: Redirects to `/dashboard` and backend APIs execute.<br>**Fail**: Redirect fails or user is not marked onboarded. |
| **TC-09** | **Provisioning** | API Provisioning handles already provisioned users gracefully | `POST /api/provision`<br>Mock Profile: `clientId` & `baseId` already set in profiles table. | API returns status `200` with `{ ok: true, already: true }`. GHL and Airtable are NOT written to again. | **Pass**: Output contains `already: true`, no duplicate writes.<br>**Fail**: Overwrites profiles or errors. |
| **TC-10** | **Provisioning** | API creates GHL contact, Airtable row, welcome SMS, and links profile | `POST /api/provision`<br>Mock Profile: No `clientId`, name: `Abe Lincoln`, phone: `+15551112222`. | 1. Creates GHL contact<br>2. Inserts Airtable profile<br>3. Dispatches welcome SMS via GHL<br>4. Links Supabase profile. | **Pass**: Returns `provisioned: true` and all four steps execute successfully.<br>**Fail**: Any critical database link step fails. |
| **TC-11** | **Dashboard** | Unprovisioned user displays warning banner | Load `/dashboard`<br>Mock coaching: `{ configured: false, reason: "not_provisioned" }` | Warning banner displayed: "Your coaching isn't set up yet... workspace hasn't been provisioned." KPI cards show dashes. | **Pass**: Setup warning banner renders; no scores shown.<br>**Fail**: Dashboard throws a runtime error or shows empty graphs. |
| **TC-12** | **Dashboard Tour** | Interactive Tour executes on first login and writes to localstorage | Load `/dashboard` (first time)<br>Mock `localStorage`: Clear all keys. | 1. Tour overlay is shown.<br>2. Card highlights 'tour-score' card.<br>3. Next moves steps.<br>4. Skip/Done sets local storage key `relentless-dashboard-tour-complete:<userId>` = `1`. | **Pass**: Tour automatically pops up, navigates correctly, and persists close state.<br>**Fail**: Tour doesn't show, or can't be closed. |
| **TC-13** | **Task Management** | Adding task updates database and mirrors to GHL | Add task title `Sell 10 subscriptions` with due date.<br>Mock GHL: Return task ID `ghl_task_foo`. | 1. Inserted into Supabase tasks table<br>2. `POST /api/tasks-sync` executes `op: "create"`<br>3. Task list updates with priority `MED` and due date label.<br>4. Supabase task record updated with `ghl_task_id`. | **Pass**: Task is visible in UI, stored in DB, and GHL sync API responds successfully.<br>**Fail**: Task fails to save or is lost on refresh. |
| **TC-14** | **Task Management** | Toggling task to done updates DB and GHL | Check box of task with `ghl_task_id: "ghl_task_foo"`. | 1. Local state updates to done.<br>2. Supabase row set to `done: true`.<br>3. `POST /api/tasks-sync` executes `op: "complete"`. | **Pass**: Toast "Task completed" appears; DB and GHL are synced.<br>**Fail**: UI toggles but DB is not updated, or GHL sync fails. |
| **TC-15** | **Task Seeding** | Weekly recurring tasks seeded once per week | Load `/dashboard`<br>Mock state: Task list has no tasks containing the ISO week key (e.g. `2026-W26`). | 1. Seeding logic detects first load of the week.<br>2. Inserts 5 recurring tasks.<br>3. Saves flag `recurring-seeded-2026-W26` to `localStorage` and DB. | **Pass**: 5 standard executive tasks appear on the dashboard; subsequent reloads do not duplicate them.<br>**Fail**: No tasks seeded, or tasks duplicate on reload. |
| **TC-16** | **Google Calendar** | Google Calendar sync fetches events, drops stale records, and saves new ones | Trigger sync from connections page.<br>Mock calendar API: Return 2 events.<br>Mock DB: Existing Google-sourced meetings. | 1. Drops old google-sourced meetings.<br>2. Fetch and formats the new ones.<br>3. Inserts into database.<br>4. Dashboard meeting panel updates. | **Pass**: UI reflects synced events; old sync records are purged from database.<br>**Fail**: Duplicate entries are saved, or sync returns error. |
| **TC-17** | **War Room (AI)** | Gated features block non-pro plan users | Click "Start a session" (War Room)<br>Mock profile plan: `"standard"`. | API `/api/warroom` returns status `403` with `{ error: "War Room is a Pro feature." }`. | **Pass**: Non-pro users blocked from access.<br>**Fail**: Non-pro user can initiate AI strategist session. |
| **TC-18** | **Diagnostic Quiz** | Completing quiz calculates score and posts lead | Answer 9 questions. Submit lead form with Name: `Sam`, Phone: `+12223334444`. | 1. Score is aggregated.<br>2. Primary/Secondary bottleneck diagnosed.<br>3. `POST /api/diagnostic` saves lead records to Airtable.<br>4. Displays success screen. | **Pass**: Lead saved successfully; correct bottleneck shown.<br>**Fail**: Missing lead details or calculation logic errors. |
