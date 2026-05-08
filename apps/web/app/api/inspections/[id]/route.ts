import { NextResponse } from "next/server";
import { getInspectionRepository } from "../../../../server/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const inspection = await getInspectionRepository().getInspection(id);
  if (!inspection) return NextResponse.json({ error: "Inspection not found." }, { status: 404 });
  return NextResponse.json({ inspection });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await getInspectionRepository().deleteInspection({ inspectionId: id });
  return NextResponse.json({ deleted: true }, { status: 200 });
}
