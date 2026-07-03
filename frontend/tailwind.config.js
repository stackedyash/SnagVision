/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Primary accent
        accent:      '#D32F2F',
        'accent-dk': '#B71C1C',
        'accent-lt': '#FFEBEE',

        // Neutrals
        charcoal: '#111111',
        'gray-muted': '#666666',

        // Surface
        'bg-base':    '#F8F7F4',
        'bg-surface': '#FFFFFF',
        'bg-hover':   '#F3F2EF',

        // Borders
        border:       '#E5E5E5',
        'border-dim': '#EBEAE6',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card:  '0 1px 3px rgba(0,0,0,0.05)',
        'card-md': '0 2px 8px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
}
