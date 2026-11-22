import { ComingSoon } from "@/components/coming-soon";
import { tool } from "@/lib/tools";

export const metadata = { title: `${tool("rebuild").name} · Musica` };

export default function RebuildPage() {
  return <ComingSoon slug="rebuild" />;
}
