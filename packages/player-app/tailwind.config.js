/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          dark: '#0a0a14',
          cyan: '#00f3ff',
          magenta: '#ff0055',
          yellow: '#ffe600',
          purple: '#8b00ff',
          gold: '#ffd700'
        }
      },
      fontFamily: {
        mono: ['"Google Sans Code"', 'monospace', 'Courier New'],
        display: ['"Google Sans Flex"', 'sans-serif']
      }
    },
  },
  plugins: [],
}
