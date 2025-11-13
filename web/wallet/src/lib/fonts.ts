import localFont from 'next/font/local';

export const interTight = localFont({
  src: [
    {
      path: '../../fonts/Inter_Tight/InterTight-VariableFont_wght.ttf',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: '../../fonts/Inter_Tight/InterTight-Italic-VariableFont_wght.ttf',
      weight: '100 900',
      style: 'italic',
    },
  ],
  variable: '--font-inter-tight',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'sans-serif'],
});

export const jetbrainsMono = localFont({
  src: [
    {
      path: '../../fonts/JetBrains_Mono/JetBrainsMono-VariableFont_wght.ttf',
      weight: '100 800',
      style: 'normal',
    },
    {
      path: '../../fonts/JetBrains_Mono/JetBrainsMono-Italic-VariableFont_wght.ttf',
      weight: '100 800',
      style: 'italic',
    },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: true,
  fallback: ['monospace'],
});

