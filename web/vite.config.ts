import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    // `vite preview` validates the Host header by default and rejects
    // anything not on this list (DNS-rebinding protection) — without
    // this, the container works fine locally (Host: localhost) but
    // silently 403s every real request once the Cloudflare Tunnel
    // forwards the public Host header (bora.giomartins.dev) through to
    // it. See infra/cloudflared/config.yml's bora.giomartins.dev entry.
    allowedHosts: ['bora.giomartins.dev', 'localhost'],
  },
})
