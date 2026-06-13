import { NextResponse } from "next/server";
import { getEnterpriseProfile, saveEnterpriseProfile } from "@/lib/enterprise/service";

export async function GET() {
  const profile = await getEnterpriseProfile();
  return NextResponse.json({ profile });
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json();
    const profile = await saveEnterpriseProfile(payload);
    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "企业信息保存失败。";

    if (message.startsWith("ENTERPRISE_REQUIRED_FIELDS:")) {
      return NextResponse.json({ error: "请先填写公司名称、品牌简称、产品/服务和地区。" }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
