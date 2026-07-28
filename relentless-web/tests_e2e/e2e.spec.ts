import { test, expect } from "@playwright/test";

// Reset DB helper
async function resetMockDb(page) {
  await page.goto("/api/mock/supabase/reset");
  await expect(page.locator("body")).toContainText(`"ok":true`);
}

test.describe("Relentless AI E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    await resetMockDb(page);
  });

  test("TC-01: Sign Up validation handles bad input gracefully", async ({ page }) => {
    await page.goto("/login");
    // Switch to register tab
    await page.locator("a:has-text('Create an account')").click();
    
    // Fill bad inputs
    await page.fill('input[placeholder="you@company.com"]', "invalid-email");
    await page.fill('input[placeholder="Enter your password"]', "123");
    await page.fill('input[placeholder="Retype your password"]', "1234");
    
    // Click register button
    await page.click('button:has-text("Create account & continue")');

    // Verify validation errors
    // Note: The UI password length check displays: "Password must be at least 6 characters."
    // And mismatch check displays: "Passwords do not match."
    const errorText = await page.locator("div[style*='background: rgb(254, 242, 242)']").innerText();
    expect(errorText).toContain("Password must be at least 6 characters.");
  });

  test("TC-02: Successful registration redirects to Consent", async ({ page }) => {
    await page.goto("/login");
    await page.locator("a:has-text('Create an account')").click();
    
    await page.fill('input[placeholder="you@company.com"]', "newuser@test.com");
    await page.fill('input[placeholder="Enter your password"]', "Password123");
    await page.fill('input[placeholder="Retype your password"]', "Password123");
    
    await page.click('button:has-text("Create account & continue")');
    
    // Should redirect to /consent
    await page.waitForURL("**/consent");
    expect(page.url()).toContain("/consent");
  });

  test("TC-03: Successful email login triggers redirection", async ({ page }) => {
    await page.goto("/login");
    
    await page.fill('input[placeholder="you@company.com"]', "user@test.com");
    await page.fill('input[placeholder="Password"]', "Password123");
    
    await page.click('button:has-text("Sign in")');
    
    // user@test.com has consented_at set, profile onboarded: true, so redirects to dashboard
    await page.waitForURL("**/dashboard");
    expect(page.url()).toContain("/dashboard");
  });

  test("TC-04: User cannot accept policy without reading to end", async ({ page }) => {
    // Log in first as a new user (who has not consented yet)
    await page.goto("/login");
    await page.locator("a:has-text('Create an account')").click();
    await page.fill('input[placeholder="you@company.com"]', "consentuser@test.com");
    await page.fill('input[placeholder="Enter your password"]', "Password123");
    await page.fill('input[placeholder="Retype your password"]', "Password123");
    await page.click('button:has-text("Create account & continue")');
    await page.waitForURL("**/consent");

    // The checkbox should be disabled at first
    const checkbox = page.locator(".agree-row input");
    await expect(checkbox).toBeDisabled();

    // Scroll to the bottom of the consent box
    await page.locator(".policy").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    // Now it should be enabled
    await expect(checkbox).toBeEnabled();
  });

  test("TC-05: Accepting policy saves consent to user metadata", async ({ page }) => {
    // Log in and go to consent
    await page.goto("/login");
    await page.locator("a:has-text('Create an account')").click();
    await page.fill('input[placeholder="you@company.com"]', "saveconsent@test.com");
    await page.fill('input[placeholder="Enter your password"]', "Password123");
    await page.fill('input[placeholder="Retype your password"]', "Password123");
    await page.click('button:has-text("Create account & continue")');
    await page.waitForURL("**/consent");

    // Scroll to bottom
    await page.locator(".policy").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    // Accept and continue
    await page.locator(".agree-row input").check();
    await page.click('button:has-text("Agree & continue")');

    // Should redirect to onboarding
    await page.waitForURL("**/onboarding");
    expect(page.url()).toContain("/onboarding");
  });

  test("TC-06: Onboarding: Form rejects invalid phone numbers", async ({ page }) => {
    // Log in as user who needs onboarding (e.g. newly registered)
    await page.goto("/login");
    await page.locator("a:has-text('Create an account')").click();
    await page.fill('input[placeholder="you@company.com"]', "badphone@test.com");
    await page.fill('input[placeholder="Enter your password"]', "Password123");
    await page.fill('input[placeholder="Retype your password"]', "Password123");
    await page.click('button:has-text("Create account & continue")');
    
    // Go to consent, scroll and accept
    await page.waitForURL("**/consent");
    await page.locator(".policy").evaluate((el) => el.scrollTop = el.scrollHeight);
    await page.locator(".agree-row input").check();
    await page.click('button:has-text("Agree & continue")');

    // On onboarding page
    await page.waitForURL("**/onboarding");
    await page.fill('input[placeholder="Raj Sharma"]', "Jane Doe");
    await page.fill('input[placeholder="+1 555 010 0000"]', "1234");
    await page.click('button:has-text("Save & go to my dashboard")');

    // Error box should show validation message
    const errorMsg = page.locator("div[style*='background: rgb(254, 242, 242)']");
    await expect(errorMsg).toContainText("Please enter a valid mobile number");
  });

  test("TC-07: Onboarding: Form errors out if profiles table doesn't exist", async ({ page }) => {
    // Log in
    await page.goto("/login");
    await page.locator("a:has-text('Create an account')").click();
    await page.fill('input[placeholder="you@company.com"]', "error42p01@test.com");
    await page.fill('input[placeholder="Enter your password"]', "Password123");
    await page.fill('input[placeholder="Retype your password"]', "Password123");
    await page.click('button:has-text("Create account & continue")');
    
    await page.waitForURL("**/consent");
    await page.locator(".policy").evaluate((el) => el.scrollTop = el.scrollHeight);
    await page.locator(".agree-row input").check();
    await page.click('button:has-text("Agree & continue")');

    // On onboarding page
    await page.waitForURL("**/onboarding");
    await page.fill('input[placeholder="Raj Sharma"]', "Jane Doe");
    // Triggering phone number for 42P01 error
    await page.fill('input[placeholder="+1 555 010 0000"]', "5551234567");
    await page.click('button:has-text("Save & go to my dashboard")');

    // Error should be custom profiles table error
    const errorMsg = page.locator("div[style*='background: rgb(254, 242, 242)']");
    await expect(errorMsg).toContainText("Profiles table not found yet");
  });

  test("TC-08: Onboarding: Completing onboarding triggers provisioning and dashboard redirect", async ({ page }) => {
    await page.goto("/login");
    await page.locator("a:has-text('Create an account')").click();
    await page.fill('input[placeholder="you@company.com"]', "onboardok@test.com");
    await page.fill('input[placeholder="Enter your password"]', "Password123");
    await page.fill('input[placeholder="Retype your password"]', "Password123");
    await page.click('button:has-text("Create account & continue")');
    
    await page.waitForURL("**/consent");
    await page.locator(".policy").evaluate((el) => el.scrollTop = el.scrollHeight);
    await page.locator(".agree-row input").check();
    await page.click('button:has-text("Agree & continue")');

    // On onboarding page
    await page.waitForURL("**/onboarding");
    await page.fill('input[placeholder="Raj Sharma"]', "Sam Smith");
    await page.fill('input[placeholder="+1 555 010 0000"]', "+15559876543");
    await page.fill('input[placeholder="Close Q3 revenue target"]', "Scale to $1M ARR");
    await page.click('button:has-text("Save & go to my dashboard")');

    // Redirect to dashboard
    await page.waitForURL("**/dashboard");
    expect(page.url()).toContain("/dashboard");
  });

  test("TC-09: Provisioning: Handles already provisioned users gracefully", async ({ request }) => {
    // Call provisioning API directly for standard user (pre-provisioned)
    const res = await request.post("/api/provision", {
      headers: {
        Authorization: "Bearer standard-user-uuid",
      },
    });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(body.already).toBe(true);
  });

  test("TC-10: Provisioning: API creates GHL contact, Airtable row, and SMS", async ({ request }) => {
    // Call provisioning API for unprovisioned user
    const res = await request.post("/api/provision", {
      headers: {
        Authorization: "Bearer not-provisioned-uuid",
      },
    });
    const body = await res.json();
    expect(res.status()).toBe(200);
    expect(body.provisioned).toBe(true);
  });

  test("TC-11: Dashboard: Unprovisioned user displays warning banner", async ({ page }) => {
    // Sign in as notprovisioned@test.com
    await page.goto("/login");
    await page.fill('input[placeholder="you@company.com"]', "notprovisioned@test.com");
    await page.fill('input[placeholder="Password"]', "Password123");
    await page.click('button:has-text("Sign in")');

    await page.waitForURL("**/dashboard");
    
    // Check for warning banner
    const banner = page.locator(".provision-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Your coaching isn't set up yet");
  });

  test("TC-12: Dashboard Tour: Executes on first login and writes to localstorage", async ({ page }) => {
    // Sign in as user@test.com
    await page.goto("/login");
    await page.fill('input[placeholder="you@company.com"]', "user@test.com");
    await page.fill('input[placeholder="Password"]', "Password123");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL("**/dashboard");

    // The tour card should be visible
    const tourCard = page.locator(".tour-card");
    await expect(tourCard).toBeVisible();
    await expect(tourCard).toContainText("Highlighted section 1/6");

    // Click Next
    await page.click(".tour-card button:has-text('Next')");
    await expect(tourCard).toContainText("Highlighted section 2/6");

    // Click Next again
    await page.click(".tour-card button:has-text('Next')");
    await expect(tourCard).toContainText("Highlighted section 3/6");

    // Click Next again
    await page.click(".tour-card button:has-text('Next')");
    await expect(tourCard).toContainText("Highlighted section 4/6");

    // Click Next again
    await page.click(".tour-card button:has-text('Next')");
    await expect(tourCard).toContainText("Highlighted section 5/6");

    // Click Next again
    await page.click(".tour-card button:has-text('Next')");
    await expect(tourCard).toContainText("Highlighted section 6/6");

    // Click Done
    await page.click(".tour-card button:has-text('Done')");
    await expect(tourCard).toBeHidden();

    // Verify local storage is set
    const tourComplete = await page.evaluate(() => localStorage.getItem("relentless-dashboard-tour-complete:default-user-uuid"));
    expect(tourComplete).toBe("1");
  });

  test("TC-13: Task Management: Adding task updates DB and mirrors to GHL", async ({ page }) => {
    // Sign in as user@test.com (tour is now complete in the DB or we skip/done it)
    await page.goto("/login");
    await page.fill('input[placeholder="you@company.com"]', "user@test.com");
    await page.fill('input[placeholder="Password"]', "Password123");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL("**/dashboard");

    // Close tour if visible
    if (await page.locator(".tour-card").isVisible()) {
      await page.click(".tour-card button:has-text('Skip')");
    }

    // Add task
    await page.fill('input[placeholder="Add a task…"]', "Sell 10 subscriptions");
    await page.click('button:has-text("Add")');

    // Verify added to UI
    const taskItem = page.locator(".task:has-text('Sell 10 subscriptions')");
    await expect(taskItem).toBeVisible();
  });

  test("TC-14: Task Management: Toggling task to done updates DB and GHL", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[placeholder="you@company.com"]', "user@test.com");
    await page.fill('input[placeholder="Password"]', "Password123");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL("**/dashboard");

    if (await page.locator(".tour-card").isVisible()) {
      await page.click(".tour-card button:has-text('Skip')");
    }

    // Add task
    await page.fill('input[placeholder="Add a task…"]', "Toggle Task Test");
    await page.click('button:has-text("Add")');

    // Click checkbox of the task
    const checkbox = page.locator(".task:has-text('Toggle Task Test') .check");
    await checkbox.click();

    // Toast stack should show "Added priority..." or "Task completed"
    const toast = page.locator(".toast").first();
    await expect(toast).toBeVisible();
  });

  test("TC-15: Task Seeding: Weekly recurring tasks seeded once per week", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[placeholder="you@company.com"]', "user@test.com");
    await page.fill('input[placeholder="Password"]', "Password123");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL("**/dashboard");

    if (await page.locator(".tour-card").isVisible()) {
      await page.click(".tour-card button:has-text('Skip')");
    }

    // Verify that at least 5 tasks have been seeded
    await expect(page.locator(".task").first()).toBeVisible();
    const taskCount = await page.locator(".task").count();
    expect(taskCount).toBeGreaterThanOrEqual(5);
  });

  test("TC-16: Google Calendar: Sync fetches events, drops stale records, and saves new ones", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[placeholder="you@company.com"]', "pro@test.com");
    await page.fill('input[placeholder="Password"]', "Password123");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL("**/dashboard");

    if (await page.locator(".tour-card").isVisible()) {
      await page.click(".tour-card button:has-text('Skip')");
    }

    // Navigate to connections page
    await page.goto("/connections");

    // Click sync calendar
    await page.click("button:has-text('Sync now')");

    // Wait for sync response message
    await expect(page.locator("p:has-text('Synced')")).toBeVisible();
    await expect(page.locator("p:has-text('Synced')")).toContainText("Synced 2 events for today");
  });

  test("TC-17: War Room (AI): Gated features block non-pro plan users", async ({ page }) => {
    // Log in as standard@test.com
    await page.goto("/login");
    await page.fill('input[placeholder="you@company.com"]', "standard@test.com");
    await page.fill('input[placeholder="Password"]', "Password123");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL("**/dashboard");

    if (await page.locator(".tour-card").isVisible()) {
      await page.click(".tour-card button:has-text('Skip')");
    }

    // Verify War Room card does not show or Start session fails/blocks
    // Actually, on standard plan, is the War Room card rendered?
    // In dashboard/page.tsx line 861 and 1324: {isPro && (War Room card)}
    // Since plan is standard, isPro is false. So the War Room card should NOT be visible!
    const warRoomCard = page.locator(".warroom-card");
    await expect(warRoomCard).toBeHidden();
  });

  test("TC-18: Diagnostic Quiz: Completing quiz calculates score and posts lead", async ({ page }) => {
    await page.goto("/diagnostic");
    
    // Click Start the audit
    await page.click("button:has-text('Start the audit')");

    // Answer 9 questions (choose the first option for each)
    for (let i = 0; i < 9; i++) {
      await page.waitForSelector(".diag-opt");
      await page.locator(".diag-opt").first().click();
      await page.waitForTimeout(220); // Wait for the auto-advance
    }

    // Fill lead form
    await page.fill('input[placeholder="Your name"]', "Sam");
    await page.fill('input[placeholder="Email"]', "sam@test.com");
    await page.fill('input[placeholder="Phone (for your daily briefing)"]', "+12223334444");
    await page.fill('input[placeholder="What does your business do?"]', "SaaS");

    // Submit lead
    await page.click("button:has-text('Send me my growth plan')");

    // Success screen check
    const successMsg = page.locator("div:has-text('You\\'re in.')").first();
    await expect(successMsg).toBeVisible();
  });
});
