/** @type {import("tailwindcss").Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#0f0f0f",
        panel: "#1a1a1a",
        accent: "#3b82f6",
      },
      boxShadow: {
        lift: "0 16px 36px rgba(0,0,0,0.45)",
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeInUp: "fadeInUp 220ms ease-out",
      },
    },
  },
  plugins: [],
};