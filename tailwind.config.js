/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
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
