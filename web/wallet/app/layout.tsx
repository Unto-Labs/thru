import { GlobalPolyfill } from '@/components/GlobalPolyfill';
import { PreAlphaBanner } from '@/components/PreAlphaBanner';
import { WalletProviders } from '@/providers/WalletProviders';
import { interTight, jetbrainsMono } from '@/lib/fonts';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Thru Wallet',
  description: 'Secure and simple wallet for Thru',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${interTight.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <GlobalPolyfill />
        <PreAlphaBanner />
        <WalletProviders>
          {children}
        </WalletProviders>
      </body>
    </html>
  );
}
