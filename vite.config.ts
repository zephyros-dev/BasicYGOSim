import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE ?? '/',
  worker: { format: 'es' },
  optimizeDeps: {
    include: ['@codemirror/state', '@codemirror/view', '@codemirror/language', '@lezer/highlight'],
  },
});
