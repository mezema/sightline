import { NextResponse } from "next/server";
import { getInspectionRepository } from "../../../../../server/repository";

type CompleteUploadsRequest = {
  imageAssetIds?: string[];
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as CompleteUploadsRequest;
    const inspection = await getInspectionRepository().completeUploads({
      inspectionId: id,
      imageAssetIds: body.imageAssetIds ?? [],
    });
    return NextResponse.json({ inspection });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not complete uploads." }, { status: 400 });
  }
}
