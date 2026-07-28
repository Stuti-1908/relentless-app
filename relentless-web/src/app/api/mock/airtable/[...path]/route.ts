import { NextResponse } from "next/server";
import { db } from "../../db";

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;
  const { searchParams } = new URL(req.url);

  // path[0] is baseId, path[1] is table name (e.g. tbl_client_profile)
  const table = path[1] as keyof typeof db.airtable;
  if (!db.airtable[table]) {
    return NextResponse.json({ error: `Table ${table} not found` }, { status: 404 });
  }

  // Parse client_id filter from formula like "{client_id}='client_test'"
  const filterByFormula = searchParams.get("filterByFormula") || "";
  const match = filterByFormula.match(/'([^']+)'/);
  const clientId = match ? match[1] : null;

  let records = db.airtable[table];
  if (clientId) {
    records = records.filter((r) => r.fields.client_id === clientId);
  }

  // Sort by date if sort is specified
  const sortField = searchParams.get("sort[0][field]");
  const sortDirection = searchParams.get("sort[0][direction]");
  if (sortField) {
    records = [...records].sort((a, b) => {
      const valA = String(a.fields[sortField] || "");
      const valB = String(b.fields[sortField] || "");
      return sortDirection === "desc" ? valB.localeCompare(valA) : valA.localeCompare(valB);
    });
  }

  const maxRecords = Number(searchParams.get("maxRecords") || "100");
  records = records.slice(0, maxRecords);

  return NextResponse.json({ records });
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;
  const table = path[1] as keyof typeof db.airtable;

  if (!db.airtable[table]) {
    return NextResponse.json({ error: `Table ${table} not found` }, { status: 404 });
  }

  const body = await req.json();
  const fields = body.fields || {};
  const id = "recMock" + Math.random().toString(36).substring(2, 10);

  const newRecord = { id, fields };
  db.airtable[table].push(newRecord);

  return NextResponse.json(newRecord);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;
  const table = path[1] as keyof typeof db.airtable;
  const recordId = path[2];

  if (!db.airtable[table]) {
    return NextResponse.json({ error: `Table ${table} not found` }, { status: 404 });
  }

  const body = await req.json();
  const fields = body.fields || {};

  const record = db.airtable[table].find((r) => r.id === recordId);
  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  Object.assign(record.fields, fields);

  return NextResponse.json(record);
}
