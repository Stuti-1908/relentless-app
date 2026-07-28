import { NextResponse } from "next/server";
import { db } from "../../db";

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;

  // 1. POST /contacts/
  if (path[0] === "contacts" && path.length === 1) {
    const body = await req.json();
    const contactId = "ghl_contact_" + Math.random().toString(36).substring(2, 10);
    const contact = {
      id: contactId,
      locationId: body.locationId,
      name: body.name,
      phone: body.phone,
      email: body.email,
    };
    db.ghl.contacts.push(contact);
    return NextResponse.json({ contact });
  }

  // 2. POST /contacts/:contactId/tasks
  if (path[0] === "contacts" && path[2] === "tasks" && path.length === 3) {
    const contactId = path[1];
    const body = await req.json();
    const taskId = "ghl_task_" + Math.random().toString(36).substring(2, 10);
    const task = {
      id: taskId,
      contactId,
      title: body.title,
      body: body.body || "",
      dueDate: body.dueDate,
      completed: body.completed || false,
    };
    db.ghl.tasks.push(task);
    return NextResponse.json({ task: { id: taskId }, id: taskId });
  }

  // 3. POST /conversations/messages
  if (path[0] === "conversations" && path[1] === "messages") {
    const body = await req.json();
    db.ghl.messages.push({
      contactId: body.contactId,
      type: body.type,
      message: body.message,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function PUT(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;

  // 1. PUT /contacts/:contactId/tasks/:taskId
  if (path[0] === "contacts" && path[2] === "tasks" && path.length === 4) {
    const taskId = path[3];
    const body = await req.json();
    const task = db.ghl.tasks.find((t) => t.id === taskId);
    if (task) {
      task.completed = body.completed;
      return NextResponse.json({ ok: true, task });
    }
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const path = resolvedParams.path;

  // 1. DELETE /contacts/:contactId/tasks/:taskId
  if (path[0] === "contacts" && path[2] === "tasks" && path.length === 4) {
    const taskId = path[3];
    const idx = db.ghl.tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      db.ghl.tasks.splice(idx, 1);
      return NextResponse.json({ ok: true });
    }
    // Return 200 or 404 for idempotent deletion
    return NextResponse.json({ ok: true, note: "task not found, idempotent success" });
  }

  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}
