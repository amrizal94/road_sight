/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        primary: "#3b82f6",
        "bg-dark": "#0f1729",
        "card-dark": "#1a2332",
        "card-dark-alt": "#151e2d",
        muted: "#64748b",
        "sidebar-dark": "#0d1320",
      },
    },
  },
  plugins: [],
};
