import { NextResponse } from "next/server";
import { getInspectionRepository } from "../../../../server/repository";

type UploadSessionRequest = {
  description?: string;
  reference?: {
    filename?: string;
    mimeType?: string;
    byteSize?: number;
    width?: number;
    height?: number;
  };
  targets?: Array<{
    filename?: string;
    mimeType?: string;
    byteSize?: number;
    width?: number;
    height?: number;
  }>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UploadSessionRequest;
    if (!body.reference) return NextResponse.json({ error: "Reference image is required." }, { status: 400 });
    const targets = body.targets ?? [];
    const session = await getInspectionRepository().createUploadSession({
      description: body.description ?? "",
      reference: {
        filename: body.reference.filename ?? "",
        mimeType: body.reference.mimeType ?? "",
        byteSize: body.reference.byteSize ?? 0,
        width: body.reference.width,
        height: body.reference.height,
      },
      targets: targets.map((target) => ({
        filename: target.filename ?? "",
        mimeType: target.mimeType ?? "",
        byteSize: target.byteSize ?? 0,
        width: target.width,
        height: target.height,
      })),
    });
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create upload session." }, { status: 400 });
  }
}
