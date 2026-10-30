import { defineConfig, loadEnv } from 'vite';

// BACKEND_URL from client/.env or the shell is built into the app, since a
// package does not carry .env.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      BACKEND_URL: JSON.stringify(env.BACKEND_URL || 'http://localhost:3000'),
    },
  };
});
