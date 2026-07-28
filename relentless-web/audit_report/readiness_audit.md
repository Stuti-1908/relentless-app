# Relentless AI — Launch Readiness Audit Report

## 1. Executive Summary
This document outlines the results of a comprehensive code audit conducted for **Relentless AI**. The objective of the audit was to verify launch readiness by inspecting system integrations, security configurations (Supabase Row Level Security), synchronization webhooks, user experience layout, time/timezone computations, and error handling behaviors.

The audit identified **9 concrete technical risks** that range in severity from visual bugs to critical security blockers. Addressing these risks prior to launch is necessary to ensure data privacy, system consistency, and a seamless client experience.

---

## 2. Risk Classification Matrix

| Risk ID | Risk Description | Focus Area | Severity | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Risk #1** | Missing INSERT RLS Policy on Profiles Table Blocks New Signups | Database Security / User Onboarding | **Blocker** | Pending Remediation |
| **Risk #2** | Lack of Error Handling & Retries in Sync Handlers | System Integration / Reliability | **High** | Pending Remediation |
| **Risk #3** | Task CRUD Race Condition between Client-side UI & CRM Sync | Data Integrity & CRUD Operations | **High** | Pending Remediation |
| **Risk #4** | War Room User Messages Rendered Invisible (CSS visual issue) | User Interface / CSS Stylesheets | **High** | Pending Remediation |
| **Risk #5** | Broken E.164 Phone Number Normalization logic | Utility Logic & SMS Integrations | **High** | Pending Remediation |
| **Risk #6** | Over-Scoped Calendar Sync Deleting All Google Meetings Across All Time | Calendar Integration / Data Retention | **High** | Pending Remediation |
| **Risk #7** | Calendar Sync Timezone Discrepancy (Wrong-Day Sync) | Timezones & Math | **High** | Pending Remediation |
| **Risk #8** | Silently Ignored Database Errors in Meetings Card | UI / Error Boundaries | **Medium** | Pending Remediation |
| **Risk #9** | ESLint / Code Quality Rule Failures in Production Codebase | Code Quality & CI/CD | **Medium** | Pending Remediation |

---

## 3. Detailed Risk Analysis & Remediation Plans

### Risk #1: Missing INSERT RLS Policy on Profiles Table Blocks New Signups
*   **Severity:** **Blocker**
*   **Focus Area:** Database Security / User Onboarding
*   **Affected Files:** 
    *   `build/n8n/supabase_rls.sql` (Line definitions for `profiles` policies)
    *   `relentless-web/src/app/onboarding/page.tsx` (Line 129: `.upsert()`)
*   **Description & Root Cause:** 
    The `supabase_rls.sql` schema enables Row Level Security (RLS) on the `profiles` table and defines policies for `SELECT` ("profiles: own row read") and `UPDATE` ("profiles: own row update"). However, it lacks an `INSERT` policy. During the onboarding step, the client app performs an upsert:
    ```typescript
    const { error: err } = await supabase.from("profiles").upsert({ id: user.id, ... });
    ```
    When a brand-new user completes onboarding and has no existing profile row, this upsert acts as an `INSERT`. Lacking an explicit RLS `INSERT` policy, Postgres rejects the client request with a `42501` insufficient privileges error, blocking new signups from completing onboarding.
*   **Recommended Step-by-Step Fix:**
    1.  Open `build/n8n/supabase_rls.sql` and add an INSERT policy block below the read/update policies:
        ```sql
        -- Profiles: own row insert
        create policy "profiles: own row insert"
          on public.profiles for insert
          with check (auth.uid() = id);
        ```
    2.  Run this policy creation statement inside the Supabase SQL editor on the target database instance.
    3.  Test onboarding with a newly created user account to verify the profile row writes without RLS error.

---

### Risk #2: Lack of Error Handling & Retries in Sync Handlers
*   **Severity:** **High**
*   **Focus Area:** System Integration / Reliability
*   **Affected Files:** 
    *   `relentless-web/src/app/api/tasks-sync/route.ts`
    *   `relentless-web/src/app/api/profile-sync/route.ts`
*   **Description & Root Cause:** 
    Outbound API calls to Airtable and GoHighLevel (GHL) APIs are not wrapped in try-catch-retry loops. In the event of temporary network blips, external API rate limiting, or temporary downstream server errors, the sync operation fails and returns a `500` or `502` error immediately, leaving the CRM and the local database desynchronized.
*   **Recommended Step-by-Step Fix:**
    1.  Implement a wrapper utility `fetchWithRetry` that performs automated retry requests for transient errors (429 and 5xx):
        ```typescript
        async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 1000): Promise<Response> {
          for (let i = 0; i < retries; i++) {
            try {
              const res = await fetch(url, options);
              if (res.ok) return res;
              if (res.status !== 429 && res.status < 500) return res; // Skip retry for client-side errors (except 429)
            } catch (err) {
              if (i === retries - 1) throw err;
            }
            // Exponential backoff
            await new Promise((r) => setTimeout(r, delay * Math.pow(2, i)));
          }
          throw new Error("Max retries exceeded");
        }
        ```
    2.  Replace direct `fetch` calls in the webhook and sync handlers with this retry wrapper.
    3.  Consider adding a DB-backed retry queue to persist failed payloads that exhaust all immediate retries, allowing a cron job to process them later.

---

### Risk #3: Task CRUD Race Condition between Client-side UI & CRM Sync
*   **Severity:** **High**
*   **Focus Area:** Data Integrity & CRUD Operations
*   **Affected File:** `relentless-web/src/app/dashboard/page.tsx` (Lines 542-572)
*   **Description & Root Cause:** 
    Adding and deleting tasks is fully asynchronous without UI locking. When a user adds a task and immediately deletes it before the GoHighLevel API resolves its task ID, the delete request executes in Supabase. Once the original GHL create request completes, the subsequent callback tries to update the now-deleted row with the GHL task ID (`supabase.from("tasks").update({ ghl_task_id: ghlId }).eq("id", task.id)`). This leaves a "zombie" task in GHL with no matching row in Supabase, leading to desynchronization.
*   **Recommended Step-by-Step Fix:**
    1.  Implement a local UI lock (such as disabling the checkbox and delete actions) for tasks that are currently syncing.
    2.  Introduce a local tracking state of in-flight task IDs:
        ```typescript
        const [syncingTasks, setSyncingTasks] = useState<Record<string, boolean>>({});
        ```
    3.  In task creation and deletion handlers, set the task as syncing, and prevent any conflicting actions until the promises resolve.
    4.  Verify in the callback that the row still exists in the local tasks state before writing the update to the Supabase database.

---

### Risk #4: War Room User Messages Rendered Invisible (CSS visual issue)
*   **Severity:** **High**
*   **Focus Area:** User Interface / CSS Stylesheets
*   **Affected File:** `relentless-web/src/app/globals.css` (Lines 607-616)
*   **Description & Root Cause:** 
    A global color override forces `.wr-msg` (the general class for War Room chat bubbles) to render black text (`color: #000 !important;`). Since user message bubbles (`.wr-msg.wr-you`) are styled with a black background (`background: var(--ink)` where `var(--ink)` is set to `#000000`), this override results in black text on a black background, making user-submitted chat messages invisible.
*   **Recommended Step-by-Step Fix:**
    1.  Refine the generic overrides in `globals.css`. Avoid the use of `!important` on general text styling for compound components.
    2.  Specifically override the text color of the user chat bubble class:
        ```css
        .wr-msg.wr-you {
          color: #ffffff !important;
          background: var(--ink);
        }
        ```
    3.  Test user inputs in the War Room slide-over and verify text readability across different states.

---

### Risk #5: Broken E.164 Phone Number Normalization logic
*   **Severity:** **High**
*   **Focus Area:** Utility Logic & SMS Integrations
*   **Affected Files:** 
    *   `relentless-web/src/app/api/profile-sync/route.ts` (Lines 13-19)
    *   `relentless-web/src/app/api/provision/route.ts` (Lines 12-16)
*   **Description & Root Cause:** 
    The phone normalization function uses simple regex `digits = raw.replace(/\D/g, "")` to sanitize numbers. This method is brittle:
    *   For UK numbers (e.g. `07700 900077`), it retains the local trunk zero prefix, yielding `+07700900077` (which routes to Russia/Kazakhstan with prefix `+7` instead of UK `+44`).
    *   For US numbers (e.g. `4155552671`), it prepends `+` but does not add the country code `1`, producing `+4155552671` instead of `+14155552671`.
    Twilio and GHL APIs reject these invalid numbers, preventing onboarding verification codes and SMS briefings from routing.
*   **Remediation:** 
    Recommend using `libphonenumber-js` or correct the custom normalization helper to format UK numbers (strip leading zero, prefix `+44`) and US numbers (add prefix `+1`).
*   **Recommended Step-by-Step Fix:**
    1.  Install a standard library like `libphonenumber-js` for robust formatting:
        ```bash
        npm install libphonenumber-js
        ```
    2.  Implement a wrapper utility that resolves country-code details:
        ```typescript
        import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";
 
        export function toE164(raw: string | null | undefined, defaultCountry: CountryCode = "US"): string | null {
          if (!raw) return null;
          const phoneNumber = parsePhoneNumberFromString(raw, defaultCountry);
          return phoneNumber && phoneNumber.isValid() ? phoneNumber.number : null;
        }
        ```
    3.  Alternatively, if a native workaround is preferred, use a corrected custom normalization helper:
        ```typescript
        export function toE164(raw: string | null | undefined, defaultCountry: "US" | "GB" = "US"): string | null {
          if (!raw) return null;
          let digits = raw.replace(/\D/g, "");
          
          // UK trunk zero normalization (starts with '07' for mobile / '0' for national, length 11)
          if (defaultCountry === "GB" || (digits.startsWith("07") && digits.length === 11)) {
            if (digits.startsWith("0")) {
              return "+44" + digits.slice(1);
            }
          }
          
          // US normalization
          if (digits.length === 10) return "+1" + digits;
          if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
          
          if (digits.startsWith("0")) digits = digits.slice(1);
          return "+" + digits;
        }
        ```
    4.  Consolidate all phone formatting logic into a single shared utility file (e.g., `relentless-web/src/lib/phone.ts`) to prevent diverging implementations between routes.

---

### Risk #6: Over-Scoped Calendar Sync Deleting All Google Meetings Across All Time
*   **Severity:** **High**
*   **Focus Area:** Calendar Integration / Data Retention
*   **Affected File:** `relentless-web/src/app/api/connections/google-calendar/sync/route.ts` (Lines 89-96)
*   **Description & Root Cause:** 
    To sync events, the sync route deletes old Google Calendar meetings using a Supabase query that targets all calendar meetings for a user without a date range constraint. This deletes *every* Google-synced meeting (past and future) in the user's account, losing historical and future meeting data.
*   **Recommended Step-by-Step Fix:**
    1.  Limit the deletion query to the boundaries of the sync window:
        ```typescript
        await supabase
          .from("meetings")
          .delete()
          .eq("user_id", user.id)
          .not("google_event_id", "is", null)
          .gte("scheduled_at", startOfDay)
          .lte("scheduled_at", endOfDay);
        ```
    2.  Alternatively, implement a Postgres `UPSERT` on the `google_event_id` field. This prevents delete operations and maintains historical records.

---

### Risk #7: Calendar Sync Timezone Discrepancy (Wrong-Day Sync)
*   **Severity:** **High**
*   **Focus Area:** Timezones & Math
*   **Affected File:** `relentless-web/src/app/api/connections/google-calendar/sync/route.ts` (Lines 56-58)
*   **Description & Root Cause:** 
    Server computes start/end of day boundaries using UTC date values, causing wrong-day calendar data retrieval for users in other timezones. Specifically, if a user in America/Los_Angeles (UTC-8) triggers a calendar sync at 8:00 PM local time (4:00 AM UTC the next day), the sync route fetches events for the next day, resulting in a wrong-day dashboard display.
*   **Remediation:** 
    Include installation instructions for `date-fns-tz` and/or a native JS workaround using `Intl.DateTimeFormat` offset calculations.
*   **Recommended Step-by-Step Fix:**
    1.  Retrieve the user's timezone from their profile in the database.
    2.  Add `date-fns-tz` and `date-fns` to `package.json` and use them to construct timezone-aware boundaries:
        ```typescript
        import { utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";
        
        const timezone = profile?.timezone || "UTC";
        const now = new Date();
        const zonedNow = utcToZonedTime(now, timezone);
        const zonedStart = new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate());
        const zonedEnd = new Date(zonedNow.getFullYear(), zonedNow.getMonth(), zonedNow.getDate() + 1);
        const startOfDay = zonedTimeToUtc(zonedStart, timezone).toISOString();
        const endOfDay = zonedTimeToUtc(zonedEnd, timezone).toISOString();
        ```
    3.  Alternatively, use a native JavaScript workaround using `Intl.DateTimeFormat` offset calculations to avoid external dependencies:
        ```typescript
        const timezone = profile?.timezone || "UTC";
        const now = new Date();
        const tzDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
        const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
        const offsetMs = tzDate.getTime() - utcDate.getTime();
        const zonedNow = new Date(now.getTime() + offsetMs);
        const zonedStart = new Date(Date.UTC(zonedNow.getUTCFullYear(), zonedNow.getUTCMonth(), zonedNow.getUTCDate()));
        const zonedEnd = new Date(Date.UTC(zonedNow.getUTCFullYear(), zonedNow.getUTCMonth(), zonedNow.getUTCDate() + 1));
        const startOfDay = new Date(zonedStart.getTime() - offsetMs).toISOString();
        const endOfDay = new Date(zonedEnd.getTime() - offsetMs).toISOString();
        ```
    4.  Pass these timezone-aware UTC boundaries to the Google Calendar events API request.

---

### Risk #8: Silently Ignored Database Errors in Meetings Card
*   **Severity:** **Medium**
*   **Focus Area:** UI / Error Boundaries
*   **Affected File:** `relentless-web/src/app/dashboard/page.tsx` (Lines 455-467)
*   **Description & Root Cause:** 
    Database errors are swallowed during query execution on the `meetings` table. If the database query throws an error, the code falls back to a legacy query, but if that also fails, the database error is caught but silently ignored. The dashboard clears the loading spinner and states "No meetings yet" instead of notifying the user of database queries failing, potentially causing the user to miss upcoming events.
*   **Recommended Step-by-Step Fix:**
    1.  Create an error state variable for meetings inside `DashboardPage`:
        ```typescript
        const [meetingError, setMeetingError] = useState<string | null>(null);
        ```
    2.  In the database fetch handler, check if the query failed:
        ```typescript
        if (mErr) {
          console.error("Meetings query failed:", mErr);
          setMeetingError("Unable to load meetings. Please check your connection.");
        } else {
          setMeetingError(null);
        }
        ```
    3.  In the JSX rendering code, check if `meetingError` is present. If so, display a localized warning banner to prompt the user to reload the page.

---

### Risk #9: ESLint / Code Quality Rule Failures in Production Codebase
*   **Severity:** **Medium**
*   **Focus Area:** Code Quality & CI/CD
*   **Affected Files:** 
    *   `relentless-web/src/app/api/mock/db.ts`
    *   `relentless-web/src/app/api/mock/supabase/[...path]/route.ts`
    *   `relentless-web/src/app/dashboard/page.tsx`
*   **Description & Root Cause:** 
    Running `npm run lint` yields typescript-eslint and react-hooks errors, blocking CI/CD pipelines. Mock database and API files use `any` (violating `@typescript-eslint/no-explicit-any`), which decreases type safety. The main dashboard page contains a synchronous `setState` call directly within an effect without proper guards or dependency control (violating `react-hooks/set-state-in-effect`).
*   **Recommended Step-by-Step Fix:**
    1.  In mock database and API files (`relentless-web/src/app/api/mock/db.ts` and `relentless-web/src/app/api/mock/supabase/[...path]/route.ts`), replace `any` with specific types or use `unknown` if types are dynamic, or add eslint disable comments.
    2.  In `relentless-web/src/app/dashboard/page.tsx` (around line 395), refactor the synchronous `setState` call out of the effect or wrap it in proper state initialization/conditional guards.
    3.  Ensure `npm run lint` passes cleanly before launch.

---

## 4. Verification Procedures

To verify remediation of these issues, perform the following validation steps:

1.  **Profiles INSERT RLS Policy (Risk #1):**
    Register a new user account, log in, and proceed to the onboarding screen. Submit the onboarding details. Ensure the profile row is successfully created in the database and the app forwards the user to `/dashboard` without throwing a `42501` insufficient privileges error.
2.  **Lack of Error Handling & Retries in Sync Handlers (Risk #2):**
    Simulate network failure or trigger rate limiting (429 status response) when calling external APIs (Airtable or GHL) during a task or profile sync. Confirm that the handler retries the request according to the exponential backoff strategy before failing.
3.  **Task CRUD Race Condition (Risk #3):**
    Add a task and immediately click delete before the task ID resolves from GHL. Confirm that the UI locks interaction or delays the delete until the creation is completed, preventing "zombie" tasks in GHL and desynchronization in Supabase.
4.  **War Room Styling (Risk #4):**
    Open the War Room chat drawer. Send a message. Confirm that the text in the message bubble is styled as white text (or readable color) on a black background, rather than black text on a black background.
5.  **Phone Normalization (Risk #5):**
    Execute unit tests on the `toE164` helper (or the wrapper around `libphonenumber-js`) with US numbers like `(415) 555-1212` and UK numbers like `07700 900077`. Confirm they format correctly to `+14155551212` and `+447700900077` respectively, verifying that the leading trunk zero `0` in the UK number is correctly stripped and replaced with the UK country prefix `+44`.
6.  **Calendar Deletes (Risk #6):**
    Populate a user's meetings table with events scheduled for yesterday, today, and tomorrow. Trigger a calendar sync. Check the database to confirm that past and future meetings are retained, and only events within today's range were updated.
7.  **Calendar Sync Timezone Discrepancy (Risk #7):**
    Simulate a client user located in a timezone with a large offset from UTC (e.g. America/Los_Angeles or Asia/Tokyo) triggering a sync during boundary hours. Confirm that the retrieved Google Calendar events correspond to the user's local calendar day, not the server's UTC day.
8.  **Silently Ignored Database Errors in Meetings Card (Risk #8):**
    Temporarily block or corrupt DB queries to the meetings table. Confirm that the UI displays a warning message/banner stating that meetings could not be loaded, rather than displaying "No meetings yet".
9.  **ESLint and Code Quality (Risk #9):**
    Run `npm run lint` in the `relentless-web` directory and verify that it compiles cleanly with zero errors/warnings, confirming that all TypeScript-eslint and React hook violations are resolved.
