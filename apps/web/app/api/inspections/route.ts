import { NextResponse } from "next/server";
import { getInspectionRepository } from "../../../server/repository";

export async function GET() {
  return NextResponse.json({ inspections: await getInspectionRepository().listInspections() });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const reference = formData.get("reference");
  const targets = formData.getAll("targets");
  const inspection = await getInspectionRepository().createInspection({
    description: String(formData.get("description") ?? ""),
    referenceFilename: reference instanceof File ? reference.name : undefined,
    targetFilenames: targets.map((target) => (target instanceof File ? target.name : "")).filter(Boolean),
  });
  return NextResponse.json({ inspection }, { status: 201 });
}
