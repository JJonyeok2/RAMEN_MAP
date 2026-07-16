import { NextResponse } from "next/server";
import { listVerifiedShops } from "../../../db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { shops: await listVerifiedShops() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to list verified shops", error);
    return NextResponse.json({ error: "검증 매장을 불러오지 못했습니다." }, { status: 500 });
  }
}
