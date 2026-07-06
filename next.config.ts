import type { NextConfig } from "next";
import { parsePublishableKey } from "@clerk/shared/keys";

function getClerkCspOrigins() {
  const origins = new Set<string>([
    "https://*.clerk.accounts.dev",
    "https://clerk.com",
    "https://challenges.cloudflare.com",
    "https://img.clerk.com",
  ]);

  const parsed = parsePublishableKey(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  if (parsed?.frontendApi) {
    origins.add(`https://${parsed.frontendApi}`);
  }

  const proxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL?.trim();
  if (proxyUrl) {
    try {
      origins.add(new URL(proxyUrl, "https://placeholder.local").origin);
    } catch {
      // Relative proxy paths are same-origin and covered by 'self'.
    }
  }

  return [...origins];
}

function buildContentSecurityPolicy() {
  const clerkOrigins = getClerkCspOrigins().join(" ");

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${clerkOrigins}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: https://img.clerk.com",
    "font-src 'self' data:",
    `connect-src 'self' ${clerkOrigins} https://api.openai.com https://*.cloud.qdrant.io https://*.qdrant.io`,
    `frame-src 'self' ${clerkOrigins}`,
    "worker-src 'self' blob:",
  ].join("; ");
}

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(),
  },
];

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_CLERK_SIGN_IN_URL:
      process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL:
      process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ?? "/sign-up",
  },
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  serverExternalPackages: ["pdf-parse"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
