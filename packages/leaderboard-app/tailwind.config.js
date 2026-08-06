/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Google Sans Flex"', '"Google Sans Text"', 'sans-serif'],
        mono: ['"Google Sans Code"', 'monospace'],
        display: ['"Google Sans Flex"', 'sans-serif'],
      },
      colors: {
        neon: {
          cyan: '#00f3ff',
          pink: '#ff0055',
          gold: '#ffd700',
          green: '#00ff88',
          purple: '#8b00ff'
        }
      }
    },
  },
  plugins: [],
}
