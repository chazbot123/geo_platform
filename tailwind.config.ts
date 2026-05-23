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
        surface: "#0b1220",
        panel: "#101827",
        panelSoft: "#13203a",
        accent: "#57e6c6",
        accentSoft: "#9af4e1",
        stroke: "rgba(148, 163, 184, 0.16)",
        ink: "#e5eefb",
        muted: "#94a3b8",
        danger: "#fb7185",
        warning: "#f59e0b"
      },
      boxShadow: {
        panel: "0 24px 60px rgba(2, 6, 23, 0.42)"
      },
      fontFamily: {
        display: ["Georgia", "Times New Roman", "serif"],
        body: ["Segoe UI", "Microsoft YaHei", "sans-serif"]
      }
    },
  },
  plugins: [],
};

export default config;
