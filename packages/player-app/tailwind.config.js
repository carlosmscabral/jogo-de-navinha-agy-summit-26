import preset from '@jogo/shared/tailwind-preset';

/**
 * Paleta e tipografia vivem no preset compartilhado (`packages/shared/tailwind-preset.js`).
 * Aqui fica só o que é próprio deste app.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  presets: [preset],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
};
