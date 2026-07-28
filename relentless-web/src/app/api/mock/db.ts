// In-memory mock database shared across API routes

export interface User {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
}

export interface Profile {
  id: string;
  full_name: string | null;
  company: string | null;
  role: string | null;
  phone: string | null;
  timezone: string | null;
  primary_goal: string | null;
  onboarded: boolean;
  client_id: string | null;
  airtable_base_id: string | null;
  ghl_contact_id: string | null;
  plan: string;
  google_calendar_refresh_token: string | null;
  google_calendar_connected_at: string | null;
  updated_at: string | null;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  priority: string;
  meta: string;
  due_date: string | null;
  done: boolean;
  ghl_task_id: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  user_id: string;
  title: string;
  meet_time: string | null;
  scheduled_at: string | null;
  google_event_id: string | null;
  reminder_sent_at: string | null;
}

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface MockDatabase {
  users: User[];
  profiles: Profile[];
  tasks: Task[];
  meetings: Meeting[];
  airtable: {
    tbl_client_profile: AirtableRecord[];
    tbl_leads: AirtableRecord[];
    tbl_daily_scores: AirtableRecord[];
    tbl_biometrics: AirtableRecord[];
    tbl_briefings: AirtableRecord[];
    tbl_nudges: AirtableRecord[];
    tbl_feedback: AirtableRecord[];
    tbl_business_health: AirtableRecord[];
    tbl_market_signals: AirtableRecord[];
    tbl_monthly_reports: AirtableRecord[];
  };
  ghl: {
    contacts: Array<{ id: string; locationId: string; name: string; phone: string; email?: string }>;
    tasks: Array<{ id: string; contactId: string; title: string; body: string; dueDate: string; completed: boolean }>;
    messages: Array<{ contactId: string; type: string; message: string }>;
  };
  google: {
    events: Array<{
      id: string;
      summary: string;
      start: { dateTime: string };
      end: { dateTime: string };
    }>;
  };
}

const initialDb = (): MockDatabase => {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // Pre-configured mock data for tests
  const defaultUserId = "default-user-uuid";
  const proUserId = "pro-user-uuid";
  const standardUserId = "standard-user-uuid";
  const notProvisionedUserId = "not-provisioned-uuid";

  const db: MockDatabase = {
    users: [
      { id: defaultUserId, email: "user@test.com", user_metadata: { consented_at: "2026-06-27T10:00:00Z" } },
      { id: proUserId, email: "pro@test.com", user_metadata: { consented_at: "2026-06-27T10:00:00Z" } },
      { id: standardUserId, email: "standard@test.com", user_metadata: { consented_at: "2026-06-27T10:00:00Z" } },
      { id: notProvisionedUserId, email: "notprovisioned@test.com", user_metadata: { consented_at: "2026-06-27T10:00:00Z" } },
    ],
    profiles: [
      {
        id: defaultUserId,
        full_name: "Abe Lincoln",
        company: "USA",
        role: "President",
        phone: "+15551112222",
        timezone: "America/New_York",
        primary_goal: "Preserve the union",
        onboarded: true,
        client_id: "client_test",
        airtable_base_id: "appjnWxg9sB3PV7Da",
        ghl_contact_id: "ghl_contact_9999",
        plan: "pro",
        google_calendar_refresh_token: null,
        google_calendar_connected_at: null,
        updated_at: now.toISOString(),
      },
      {
        id: proUserId,
        full_name: "Pro User",
        company: "Enterprise",
        role: "CEO",
        phone: "+15552223333",
        timezone: "America/Los_Angeles",
        primary_goal: "Grow enterprise value",
        onboarded: true,
        client_id: "client_pro",
        airtable_base_id: "appjnWxg9sB3PV7Da",
        ghl_contact_id: "ghl_contact_pro",
        plan: "pro",
        google_calendar_refresh_token: "mock_refresh_token",
        google_calendar_connected_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      {
        id: standardUserId,
        full_name: "Standard User",
        company: "Small Biz",
        role: "Owner",
        phone: "+15553334444",
        timezone: "America/Chicago",
        primary_goal: "Maintain lifestyle business",
        onboarded: true,
        client_id: "client_standard",
        airtable_base_id: "appjnWxg9sB3PV7Da",
        ghl_contact_id: "ghl_contact_standard",
        plan: "standard",
        google_calendar_refresh_token: null,
        google_calendar_connected_at: null,
        updated_at: now.toISOString(),
      },
      {
        id: notProvisionedUserId,
        full_name: "Not Provisioned",
        company: "Struggling Co",
        role: "Founder",
        phone: "+15554445555",
        timezone: "America/New_York",
        primary_goal: "Survive",
        onboarded: true,
        client_id: null,
        airtable_base_id: null,
        ghl_contact_id: null,
        plan: "standard",
        google_calendar_refresh_token: null,
        google_calendar_connected_at: null,
        updated_at: now.toISOString(),
      },
    ],
    tasks: [],
    meetings: [],
    airtable: {
      tbl_client_profile: [
        {
          id: "recClient1",
          fields: {
            client_id: "client_test",
            full_name: "Abe Lincoln",
            plan: "pro",
            phone_number: "+15551112222",
            timezone: "America/New_York",
            top_priority_1: "Preserve the union",
            active: true,
          },
        },
        {
          id: "recClientPro",
          fields: {
            client_id: "client_pro",
            full_name: "Pro User",
            plan: "pro",
            phone_number: "+15552223333",
            timezone: "America/Los_Angeles",
            top_priority_1: "Grow enterprise value",
            active: true,
          },
        },
        {
          id: "recClientStandard",
          fields: {
            client_id: "client_standard",
            full_name: "Standard User",
            plan: "standard",
            phone_number: "+15553334444",
            timezone: "America/Chicago",
            top_priority_1: "Maintain lifestyle business",
            active: true,
          },
        },
      ],
      tbl_leads: [],
      tbl_daily_scores: [
        {
          id: "recScore1",
          fields: {
            client_id: "client_test",
            composite_score: 85,
            score_label: "EXCELLENT",
            body_score: 90,
            focus_score: 80,
            execution_score: 85,
            alignment_score: 85,
            capital_score: 80,
            risk_score: 90,
            priorities_completed: 2,
            date: todayStr,
          },
        },
        {
          id: "recScorePro",
          fields: {
            client_id: "client_pro",
            composite_score: 92,
            score_label: "OPTIMAL",
            body_score: 95,
            focus_score: 90,
            execution_score: 90,
            alignment_score: 95,
            capital_score: 90,
            risk_score: 95,
            priorities_completed: 3,
            date: todayStr,
          },
        },
      ],
      tbl_biometrics: [
        {
          id: "recBio1",
          fields: {
            client_id: "client_test",
            recovery_score: 88,
            hrv_score: 72,
            sleep_score: 82,
            source: "Whoop",
            date: todayStr,
          },
        },
        {
          id: "recBioPro",
          fields: {
            client_id: "client_pro",
            recovery_score: 94,
            hrv_score: 85,
            sleep_score: 90,
            source: "Oura",
            date: todayStr,
          },
        },
      ],
      tbl_briefings: [
        {
          id: "recBriefing1",
          fields: {
            client_id: "client_test",
            briefing_text: "Good morning Abe. Your recovery is strong today. Protect 2 hours for deep work. Let's make sure the union is preserved.",
            top_priority_1: "Preserve the union",
            delivered_at: now.toISOString(),
            date: todayStr,
          },
        },
        {
          id: "recBriefingPro",
          fields: {
            client_id: "client_pro",
            briefing_text: "Good morning Pro CEO. Everything looks optimal.",
            top_priority_1: "Grow enterprise value",
            delivered_at: now.toISOString(),
            date: todayStr,
            sections_json: JSON.stringify({
              recovery: { summary: "Great sleep (90)", content: "Your Oura recovery is at 94%." },
              news: { summary: "Tech sector growth continues", content: "AI index up by 1.2%." },
              calendar: { summary: "3 meetings today", meetings: [{ title: "Board Meet", time: "10:00 AM" }] }
            })
          },
        },
      ],
      tbl_nudges: [],
      tbl_feedback: [],
      tbl_business_health: [
        {
          id: "recHealthPro",
          fields: {
            client_id: "client_pro",
            cash_position: "12_months_runway",
            team_health: "high_performance",
            biggest_risk: "Hiring scaling bottleneck",
            avoided_decision: "Fire underperforming Director",
            claude_analysis: "Cash is strong. Scalability is your constraint.",
            capital_score: 90,
            risk_score: 95,
            week_start_date: todayStr,
          },
        },
      ],
      tbl_market_signals: [
        {
          id: "recMarketPro",
          fields: {
            client_id: "client_pro",
            signal_text: "Rates expected to drop. Good time to refinance.",
            source: "Federal_Reserve",
            date: todayStr,
          },
        },
      ],
      tbl_monthly_reports: [
        {
          id: "recMonthlyPro",
          fields: {
            client_id: "client_pro",
            month_year: "June 2026",
            monthly_score: 88,
            base_score: 80,
            trend_bonus: 5,
            consistency_bonus: 3,
            pillar_improvement_bonus: 0,
            best_day_date: todayStr,
          },
        },
      ],
    },
    ghl: {
      contacts: [
        { id: "ghl_contact_9999", locationId: "HlI90j86nBEuhp9Oovf9", name: "Abe Lincoln", phone: "+15551112222", email: "user@test.com" },
        { id: "ghl_contact_pro", locationId: "HlI90j86nBEuhp9Oovf9", name: "Pro User", phone: "+15552223333", email: "pro@test.com" },
      ],
      tasks: [],
      messages: [],
    },
    google: {
      events: [
        {
          id: "mock_event_1",
          summary: "Q3 Board Meeting",
          start: { dateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0).toISOString() },
          end: { dateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 11, 0).toISOString() },
        },
        {
          id: "mock_event_2",
          summary: "Lunch with investor",
          start: { dateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 30).toISOString() },
          end: { dateTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 30).toISOString() },
        },
      ],
    },
  };
  return db;
};

const globalForDb = globalThis as unknown as {
  mockDb: MockDatabase;
};

export const db = globalForDb.mockDb || initialDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.mockDb = db;
}

// Helper to reset database state for tests
export function resetDb() {
  globalForDb.mockDb = initialDb();
  Object.assign(db, globalForDb.mockDb);
}
