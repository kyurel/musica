import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, tool } from "@/lib/tools";

// Placeholder page for a tool that is not built yet.
export function ComingSoon({ slug }: { slug: string }) {
  const t = tool(slug);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← All tools</Link>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{t.name}</h1>
          <Badge>{STATUS_LABEL[t.status]}</Badge>
          <span className="text-sm text-muted-foreground">{t.milestone}</span>
        </div>
        <p className="text-muted-foreground">{t.tagline}</p>
      </div>
      <div className="rounded-lg border border-dashed p-6">
        <h2 className="mb-1 font-medium">Coming soon</h2>
        <p className="mb-4 text-sm text-muted-foreground">This tool isn&apos;t built yet. Here is what it will do.</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {t.plan.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
    </div>
  );
}
