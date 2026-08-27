/**
 * Preset Tailwind compartilhado — GRAVIDADE ZERO.
 *
 * Os `tailwind.config.js` do player-app e do leaderboard-app eram byte-idênticos, o que significa
 * que qualquer ajuste de paleta só valia num deles até alguém lembrar do outro. Agora os dois
 * carregam este preset e ficam com o que de fato lhes é próprio (o `content`).
 *
 * Os mesmos valores existem como custom properties em `src/styles/theme.css`, para o painel de
 * admin, que não usa Tailwind. Ao mexer aqui, mexa lá.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: [],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#050608',
          900: '#090b10',
          850: '#0e1117',
          800: '#141822',
          700: '#1e2433',
          600: '#2b3345'
        },
        amber: {
          solar: '#ff9e0b',
          glow: '#f59e0b',
          bright: '#ffd166',
          dark: '#b45309'
        },
        cobalt: {
          DEFAULT: '#3b82f6',
          azure: '#38bdf8',
          deep: '#1d4ed8',
          light: '#93c5fd'
        },
        radar: {
          green: '#10b981',
          bright: '#34d399',
          dark: '#047857'
        },
        alert: {
          red: '#ef4444',
          crimson: '#dc2626'
        }
      },
      fontFamily: {
        sans: ['"Google Sans Flex"', '"Google Sans Text"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"Google Sans Code"', 'monospace', 'Courier New'],
        display: ['"Google Sans Flex"', 'sans-serif']
      }
    }
  },
  plugins: []
};
