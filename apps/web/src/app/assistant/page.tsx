import { ComingSoon } from "@/components/coming-soon";
import { tool } from "@/lib/tools";

export const metadata = { title: `${tool("assistant").name} · Musica` };

export default function AssistantPage() {
  return <ComingSoon slug="assistant" />;
}
