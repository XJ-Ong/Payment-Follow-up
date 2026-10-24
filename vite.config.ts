import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';

function securityHeaders(apiUrl: string) {
  const apiOrigin = apiUrl ? new URL(apiUrl).origin : '';
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${apiOrigin}; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const headers = securityHeaders(env.VITE_API_URL ?? '');
  return {
    plugins: [tailwindcss()],
    esbuild: { jsx: 'automatic' },
    server: { headers },
    preview: { headers },
    build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'] } } } },
  };
});
