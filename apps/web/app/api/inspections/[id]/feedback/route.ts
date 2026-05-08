import { NextResponse } from "next/server";
import { getInspectionRepository } from "../../../../../server/repository";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = await request.json();
  const inspection = await getInspectionRepository().createFeedback({
    inspectionId: id,
    targetId: payload.targetId,
    verdict: payload.verdict === "wrong" ? "wrong" : "correct",
  });
  return NextResponse.json({ inspection }, { status: 201 });
}
