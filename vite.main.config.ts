import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  define: {
    __DOMBOT_MACOS_UPDATE_SIGNED__: JSON.stringify(
      Boolean(process.env.APPLE_SIGNING_IDENTITY),
    ),
  },
});
