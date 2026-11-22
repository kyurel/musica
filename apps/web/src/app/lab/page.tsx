import { ComingSoon } from "@/components/coming-soon";
import { tool } from "@/lib/tools";

export const metadata = { title: `${tool("lab").name} · Musica` };

export default function LabPage() {
  return <ComingSoon slug="lab" />;
}
