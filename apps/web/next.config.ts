import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

export default nextConfig;

// Lets `next dev` see the same Cloudflare environment as the deployed app.
initOpenNextCloudflareForDev();
