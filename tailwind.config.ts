import type { Config } from 'tailwindcss';

/**
 * HR Portal design tokens.
 * Replaces the previously-empty `theme.extend`. Semantic status colours are
 * intentionally NOT here — they live in lib/status.ts so labels and colours
 * stay in one place. This file owns brand, neutrals, font, radius, shadow.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        // Neutral scale is stock Tailwind `slate` — kept as-is across the app.
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Semantic aliases layered over Tailwind's scale — use these on purpose.
        display: ['1.875rem', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.02em' }],
        title: ['1.5rem', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.01em' }],
        section: ['1.125rem', { lineHeight: '1.4', fontWeight: '600' }],
      },
      borderRadius: {
        card: '0.875rem', // 14px
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(15,23,42,0.05)',
        float: '0 20px 40px -24px rgba(15,23,42,0.35)',
      },
      ringColor: {
        brand: '#4f46e5',
      },
    },
  },
  plugins: [],
};

export default config;
