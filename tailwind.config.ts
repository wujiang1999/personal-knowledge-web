import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#effaf7",
          100: "#d7f0e7",
          200: "#b1dfd0",
          300: "#7dc8b3",
          400: "#49aa92",
          500: "#298f78",
          600: "#1d735f",
          700: "#1c5d4f",
          800: "#1a4b41",
          900: "#183e36",
          950: "#0a2823",
        },
        zinc: {
          50: "#f6f8f8",
          100: "#edf1f1",
          200: "#dde5e4",
          300: "#c3cecc",
          400: "#899b98",
          500: "#5f7470",
          600: "#4a5e5a",
          700: "#374a46",
          800: "#263733",
          900: "#192824",
          950: "#101b18",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [typography],
};

export default config;
