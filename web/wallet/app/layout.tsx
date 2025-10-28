import './globals.css';
import type { Metadata } from 'next';
import { GlobalPolyfill } from '@/components/GlobalPolyfill';
import { WalletProvider } from '@/contexts/WalletProvider';

export const metadata: Metadata = {
  title: 'Thru Wallet',
  description: 'Secure Solana wallet for iframe integration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <GlobalPolyfill />
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
