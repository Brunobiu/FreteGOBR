/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta da marca FreteGO (extraída da logo)
        brand: {
          green: '#007848', // verde principal da logo
          greenDark: '#00532f', // verde escuro p/ hover
          greenLight: '#34d399', // verde claro p/ destaques sobre fundo escuro
          navy: '#0a2a40', // azul-marinho da logo
          navyDeep: '#05202f', // marinho mais profundo p/ topo de gradiente
          lime: '#c8cc1e', // lima/amarelo de acento
        },
        // Paleta light mode FreteGO
        surface: {
          DEFAULT: '#f5f5f5', // fundo principal
          card: '#ffffff',    // cards
          section: '#f9fafb', // seções internas (gray-50)
          input: '#ffffff',   // inputs
        },
        border: {
          DEFAULT: '#e5e7eb', // gray-200
          input: '#d1d5db',   // gray-300
          strong: '#9ca3af',  // gray-400
        },
        text: {
          primary: '#1f2937',   // gray-800
          secondary: '#4b5563', // gray-600
          muted: '#6b7280',     // gray-500
          label: '#374151',     // gray-700
        },
      },
    },
  },
  plugins: [],
}
