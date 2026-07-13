import { NextResponse } from "next/server";
import { getTdxToken } from "@/lib/tdx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean(process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET);
  if (!configured) {
    return NextResponse.json(
      { ok: false, configured: false, message: "尚未設定 TDX 環境變數" },
      { status: 503 }
    );
  }

  try {
    await getTdxToken();
    return NextResponse.json({ ok: true, configured: true, tdxAuth: "ok" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        tdxAuth: "failed",
        message: error instanceof Error ? error.message : "TDX 驗證失敗",
      },
      { status: 502 }
    );
  }
}
