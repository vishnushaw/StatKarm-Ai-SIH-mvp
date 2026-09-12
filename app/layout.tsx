import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Pragati AI | Learning for Public Service', description: 'Competency-led learning for official statistics.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
