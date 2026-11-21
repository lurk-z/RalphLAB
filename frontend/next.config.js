const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("dotenv");

// Expose only the login switch from the shared FastAPI/Compose environment.
const rootEnv = path.resolve(__dirname, "../.env");
const loginSetting = process.env.LOGIN_ENABLED ??
  (fs.existsSync(rootEnv) ? parse(fs.readFileSync(rootEnv)).LOGIN_ENABLED : undefined) ?? "true";
if (!["true", "false"].includes(loginSetting)) throw new Error("LOGIN_ENABLED must be true or false");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_LOGIN_ENABLED: loginSetting },
  reactStrictMode: true,
  transpilePackages: ["three"],
  // Keep the development cache separate from production builds. Running
  // `next build` while `next dev` is open must not replace the manifests and
  // CSS chunks currently served by the dev server.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Retired pages. Old bookmarks still land somewhere useful instead of a 404.
  async redirects() {
    return [
      { source: "/register", destination: "/login", permanent: false },
      { source: "/forgot-password", destination: "/login", permanent: false },
      { source: "/settings", destination: "/projects", permanent: false },
      { source: "/projects/new", destination: "/projects", permanent: false },
      { source: "/history", destination: "/projects", permanent: false },
      { source: "/skin-viewer", destination: "/assess", permanent: false },
      { source: "/models", destination: "/", permanent: false },
      { source: "/herbs", destination: "/projects", permanent: false },
      { source: "/how-to", destination: "/", permanent: false },
      { source: "/methodology", destination: "/", permanent: false },
      { source: "/about", destination: "/", permanent: false },
      { source: "/projects/:id/results", destination: "/assess?projectId=:id", permanent: false },
    ];
  },
};

module.exports = nextConfig;
