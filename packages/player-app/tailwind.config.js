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
        sans: ['"Google Sans Flex"', '"Google Sans Text"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"Google Sans Code"', '"Share Tech Mono"', 'monospace', 'Courier New'],
        display: ['"Google Sans Flex"', '"Google Sans"', 'sans-serif'],
        arcade: ['"Press Start 2P"', 'monospace']
      }
    },
  },
  plugins: [],
}
