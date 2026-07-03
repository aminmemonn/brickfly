import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Space_Grotesk } from 'next/font/google';
import './globals.css';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' });
const body = Space_Grotesk({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'BrickFly — Fly the Brick World',
  description:
    'A browser flight simulator set on a stylized brick-built Earth. Discover famous landmarks rebuilt brick by brick.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#06090f'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} font-sans`}>{children}</body>
    </html>
  );
}
