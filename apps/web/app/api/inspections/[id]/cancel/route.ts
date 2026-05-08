import { NextResponse } from "next/server";
import { getInspectionRepository } from "../../../../../server/repository";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const inspection = await getInspectionRepository().cancelInspection({ inspectionId: id });
  return NextResponse.json({ inspection }, { status: 200 });
}
