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
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        panelSoft: "rgb(var(--color-panel-soft) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--color-accent-soft) / <alpha-value>)",
        "accent-muted": "rgb(var(--color-accent) / 0.12)",
        stroke: "rgb(var(--color-stroke) / <alpha-value>)",
        "stroke-strong": "rgb(var(--color-stroke-strong) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)"
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        glow: "var(--shadow-focus)",
      },
      fontFamily: {
        display: ["Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        body: ["Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Code", "SFMono-Regular", "Consolas", "monospace"],
      },
      backgroundImage: {
        'noise': "url('data:image/svg+xml;charset=utf-8,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')",
      }
    },
  },
  plugins: [],
};

export default config;
