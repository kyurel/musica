import { ComingSoon } from "@/components/coming-soon";
import { tool } from "@/lib/tools";

export const metadata = { title: `${tool("master").name} · Musica` };

export default function MasterPage() {
  return <ComingSoon slug="master" />;
}
