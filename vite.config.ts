import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';

function securityHeaders(apiUrl: string) {
  const apiOrigin = new URL(apiUrl).origin;
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
  const headers = securityHeaders(env.VITE_API_URL || 'http://localhost:8000');
  // Replit's development preview is embedded; keep production framing protection.
  const { 'X-Frame-Options': _frame, ...developmentHeaders } = headers;
  developmentHeaders['Content-Security-Policy'] = headers['Content-Security-Policy']
    .replace("frame-ancestors 'none'; ", '');
  return {
    plugins: [tailwindcss()],
    esbuild: { jsx: 'automatic' },
    server: {
      host: '0.0.0.0',
      port: 5000,
      strictPort: true,
      allowedHosts: true,
      headers: developmentHeaders,
      proxy: { '/api': 'http://127.0.0.1:8000' },
    },
    preview: { headers },
    build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'] } } } },
  };
});
