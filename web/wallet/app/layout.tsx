import { GlobalPolyfill } from '@/components/GlobalPolyfill';
import { WalletProvider } from '@/contexts/WalletProvider';
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
        <div className="bg-black text-white text-center py-2 px-4 text-sm">
          This is a pre-alpha unaudited application only for preview purposes.
        </div>
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
