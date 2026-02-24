import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Native module: must stay external so Electron can load the compiled .node binary.
      external: ['better-sqlite3', 'serialport'],
    },
  },
});
