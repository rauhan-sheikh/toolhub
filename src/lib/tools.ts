/**
 * Single source of truth for the tool catalogue.
 *
 * The landing grid and the nav both read from here, so adding a third tool is
 * one entry plus a page — nothing to keep in sync by hand.
 */

export type Tool = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** HSL triple, assigned to --accent so the page tints itself. */
  accent: string;
  icon: "playlist" | "download" | "gauge";
  status: "live" | "planned";
};

export const TOOLS: Tool[] = [
  {
    slug: "playlist-duration",
    name: "Playlist Duration",
    tagline: "How long is that playlist, really?",
    description:
      "Total runtime for any YouTube playlist — including your own private ones — with playback-speed maths and a count of anything unavailable.",
    accent: "0 84% 60%",
    icon: "playlist",
    status: "live",
  },
  {
    slug: "downloader",
    name: "Downloader",
    tagline: "Pull video and audio off the web.",
    description:
      "A yt-dlp front end for grabbing video, audio, subtitles and thumbnails from YouTube and a thousand other sites, with a live queue.",
    accent: "258 90% 66%",
    icon: "download",
    status: "live",
  },
  {
    slug: "oracle",
    name: "Cloud Watch",
    tagline: "What is Oracle actually charging me?",
    description:
      "Month-to-date spend across the whole Oracle tenancy, broken down by service, with every resource that exists and whether a budget alert is guarding it.",
    accent: "150 65% 45%",
    icon: "gauge",
    status: "live",
  },
];

export function getTool(slug: string): Tool | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
