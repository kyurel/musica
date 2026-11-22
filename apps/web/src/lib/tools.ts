// The tools that live inside Musica. The home page, the nav and the
// coming-soon pages all read from this list, so adding a tool is one entry
// here plus its page.

export type ToolStatus = "live" | "next" | "planned" | "later";

export type Tool = {
  slug: string;
  name: string;
  href: string;
  tagline: string;
  status: ToolStatus;
  milestone: string;
  // What the tool will do, in a few lines. Shown on its coming-soon page.
  plan: string[];
  // Extra pages that belong to the tool (shown on its home card).
  links?: { label: string; href: string }[];
};

export const STATUS_LABEL: Record<ToolStatus, string> = {
  live: "Live",
  next: "Up next",
  planned: "Planned",
  later: "Later",
};

export const TOOLS: Tool[] = [
  {
    slug: "library",
    name: "Library",
    href: "/library",
    tagline: "Every track we own, make or reference, in one shared place. Search, play, rate, crate and export.",
    status: "live",
    milestone: "Milestone 1",
    plan: [],
    links: [{ label: "Crates", href: "/crates" }],
  },
  {
    slug: "rebuild",
    name: "Rebuild",
    href: "/rebuild",
    tagline: "Turn any audio file into a Live 12 project with the parts rebuilt as MIDI over the muted original stems.",
    status: "next",
    milestone: "Milestone 2",
    plan: [
      "Pick a track from the Library or drop in any audio file.",
      "Split it into 4 stems on your Mac (Demucs or Live's own separation), so it stays free.",
      "Rebuild drums, bass and lead parts as MIDI, with both a cloned-kit and a clean-kit Drum Rack to compare.",
      "Get a Live 12 Suite project where the rebuilt parts play over the muted original stems: a starting sketch, not a finished track.",
      "A plugin check flags anything missing on the Mac that opens the project.",
    ],
  },
  {
    slug: "master",
    name: "Master",
    href: "/master",
    tagline: "Club-ready masters: match a reference, read a mix report, and get a mastering chain to finish by ear.",
    status: "planned",
    milestone: "Milestone 3",
    plan: [
      "Choose your mix and a reference track from the Library.",
      "Matchering (open source) makes an automatic master that matches the reference.",
      "A mix report shows loudness, spectrum and stereo differences against the reference.",
      "A suggested chain using Live's stock devices by default, with an optional Ozone chain for those who have it.",
      "A/B the original, the master and the reference at matched loudness, then save the master back to the Library.",
    ],
  },
  {
    slug: "assistant",
    name: "Claude power layer",
    href: "/assistant",
    tagline: "Let Claude work with the Library and the tools: ask questions, batch jobs, and reports. Optional, the app works fully without it.",
    status: "later",
    milestone: "Later",
    plan: [
      "A local MCP server on each Mac that gives Claude access to the Library.",
      "One skill per tool, so Claude can run Rebuild or Master and explain the result.",
      "Batch jobs (for example tagging or checking many tracks) run as parallel agents.",
      "Everything stays optional: every tool keeps working without Claude.",
    ],
  },
  {
    slug: "lab",
    name: "Creative tools",
    href: "/lab",
    tagline: "Room for new ideas built on the shared Library, once the core tools are in place.",
    status: "later",
    milestone: "Later",
    plan: [
      "Not planned in detail yet. New tools land here as we decide on them.",
      "Every tool reads from and saves back to the same shared Library.",
    ],
  },
];

export function tool(slug: string): Tool {
  const t = TOOLS.find((x) => x.slug === slug);
  if (!t) throw new Error(`Unknown tool: ${slug}`);
  return t;
}
