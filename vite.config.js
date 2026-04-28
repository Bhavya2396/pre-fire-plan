import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.hdr', '**/*.exr', '**/*.glb', '**/*.gltf', '**/*.bin'],
  server: {
    open: true,
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          postprocessing: ['postprocessing'],
        },
      },
    },
  },
});
