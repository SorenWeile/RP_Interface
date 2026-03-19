/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        comfy: {
          bg:         '#202020',
          panel:      '#353535',
          panelDark:  '#303030',
          canvas:     '#222',
          border:     '#4e4e4e',
          text:       '#ddd',
          muted:      '#999',
          fg:         '#fff',
          inputBg:    '#222',
          contentBg:  '#4e4e4e',
          error:      '#ff4444',
          accent:     '#64B5F6',
        },
      },
    },
  },
  plugins: [],
}
