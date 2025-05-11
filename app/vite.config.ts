import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    nodePolyfills(
      // Options (optional):
      // To exclude specific polyfills, add them to this list.
      // By default, all polyfills are included.
      // { exclude: ['fs'] }

      // Whether to polyfill `global`.
      // `global` is matching with a vite internal variable for node builds, 
      // so setting this to `true` will alias `global` to `globalThis`.
      // Default: true
      // { global: true }

      // Whether to polyfill `Buffer`.
      // Default: true
      // { buffer: true }

      // Whether to polyfill `process`.
      // Default: true
      // { process: true }
    )
  ],
  // Optional: If Lucid or its dependencies require specific optimizeDeps settings for WASM
  // optimizeDeps: {
  //   exclude: ['@lucid-evolution/lucid'], // Example, adjust as needed
  // },
  // The `define` for `global` might no longer be needed if nodePolyfills handles it,
  // but it generally doesn't hurt to keep it if it solved a previous specific issue.
  // If nodePolyfills.global is true (default), this might be redundant or could conflict.
  // Let's keep it for now and see. If new errors arise, we might remove it.
  define: {
    'global': 'window', 
  },
})
