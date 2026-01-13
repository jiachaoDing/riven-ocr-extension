// vite.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // 明确告诉 Vite：有四个入口
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        'content-script': resolve(__dirname, 'src/content/content-script.ts')
      },
      output: {
        // 所有入口文件的名字 = 入口名 + .js（不带 hash）
        entryFileNames: (chunk) => {
          return `${chunk.name}.js`;
        }
      }
    }
  }
});
