import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.js',
      name: 'GebetaMaps',
      fileName: (format) => `gebeta-maps.${format}.js`,
      formats: ['umd'],
    },
    rollupOptions: {
      output: {
        globals: {},
      },
    },
  },
}); 