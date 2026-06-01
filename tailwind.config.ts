import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: "#050505",
        panel: "#0f0f11",
        panelSoft: "#18181b",
        accent: "#ff4f00", // striking electric orange
        "accent-soft": "#ff7a33",
        "accent-muted": "rgba(255, 79, 0, 0.15)",
        stroke: "rgba(255, 255, 255, 0.08)",
        "stroke-strong": "rgba(255, 255, 255, 0.15)",
        ink: "#fafafa",
        muted: "#a1a1aa",
        danger: "#ff3366",
        warning: "#ffb800"
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(255,255,255,0.05), 0 30px 60px -10px rgba(0,0,0,0.8)",
        glow: "0 0 40px -10px rgba(255, 79, 0, 0.4)",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      backgroundImage: {
        'noise': "url('data:image/svg+xml;charset=utf-8,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')",
      }
    },
  },
  plugins: [],
};

export default config;
