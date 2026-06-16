import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";

async function readTermsDocument() {
  const filePath = path.join(process.cwd(), "GEO客户服务条款与合规承诺-签署版.md");
  return fs.readFile(filePath, "utf8");
}

export default async function ServiceTermsPage() {
  const content = await readTermsDocument();

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="section-card">
          <div className="flex flex-col gap-4 border-b border-stroke pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">GEO 服务条款</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">客户服务条款与合规承诺</h1>
            </div>
            <Link className="text-sm font-medium text-accent transition hover:text-accent-soft" href="/">
              返回启动页
            </Link>
          </div>

          <div className="mt-6 rounded-2xl border border-stroke bg-panelSoft/70 p-4 sm:p-6">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink">{content}</pre>
          </div>
        </div>
      </div>
    </main>
  );
}
