import path from "node:path";
import type { NextConfig } from "next";

// The engine and dataset live beside this app, so the workspace root is one level up.
const workspaceRoot = path.join(import.meta.dirname, "..");

const config: NextConfig = {
  turbopack: { root: workspaceRoot },
  outputFileTracingRoot: workspaceRoot,
};

export default config;
