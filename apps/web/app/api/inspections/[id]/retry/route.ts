import { NextResponse } from "next/server";
import { getInspectionRepository } from "../../../../../server/repository";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json();
  const inspection = await getInspectionRepository().retryTarget({
    inspectionId: id,
    targetId: payload.targetId,
  });
  return NextResponse.json({ inspection }, { status: 202 });
}
