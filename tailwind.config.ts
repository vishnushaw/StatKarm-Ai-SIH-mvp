import type { Config } from 'tailwindcss';
const config: Config = { content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'], theme: { extend: { colors: { ink: '#172445', brand: '#315bc6', cream: '#fff8ec' }, fontFamily: { display: ['var(--font-playfair)'], body: ['var(--font-dm-sans)'] } } }, plugins: [] };
export default config;
