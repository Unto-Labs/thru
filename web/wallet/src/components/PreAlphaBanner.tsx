'use client';

import { usePathname } from 'next/navigation';

export function PreAlphaBanner() {
  const pathname = usePathname();
  if (!pathname) {
    return null;
  }

  if (pathname.startsWith('/embedded') || pathname.startsWith('/passkey/popup')) {
    return null;
  }

  return (
    <div className="bg-black text-white text-center py-2 px-4 text-sm">
      This is a pre-alpha unaudited application only for preview purposes.
    </div>
  );
}
