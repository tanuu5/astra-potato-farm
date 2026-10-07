import { defineConfig } from 'vite';
import { devShot } from './dev/vite-plugin-dev-shot.js';

// base: './' にしておくと、GitHub Pages のサブパス（/<repo>/）でもそのまま動く。
// devShot：開発サーバーだけで使う画像の保存口（window.__dev.shot() → shots/）。公開ビルドには入らない。
export default defineConfig({
  base: './',
  plugins: [devShot()],
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
