import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// The page's Content Security Policy. The dev server needs inline scripts
// and styles for hot reload; the built pages load only their own files.
function contentSecurityPolicy(): Plugin {
  const policy = (dev: boolean) =>
    [
      "default-src 'self'",
      `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
      `style-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
      "media-src 'self' blob:",
      "connect-src 'self' http: https: ws: wss:",
    ].join('; ');
  return {
    name: 'content-security-policy',
    transformIndexHtml: (html, context) =>
      html.replace('%CSP%', policy(Boolean(context.server))),
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  build: {
    rollupOptions: {
      // A page per window.
      input: {
        index: resolve(__dirname, 'index.html'),
        subtitles: resolve(__dirname, 'subtitles.html'),
      },
    },
  },
});
