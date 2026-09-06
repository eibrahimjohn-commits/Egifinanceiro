import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // skipWaiting + clientsClaim: assim que um novo deploy termina, a aba
      // já aberta assume a versão nova na hora (com um reload automático),
      // em vez de ficar presa na versão antiga em cache até fechar tudo e
      // abrir de novo. Sem isso, uma mudança já publicada podia parecer que
      // "não pegou" mesmo estando tudo certo no código.
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'EGI Financeiro',
        short_name: 'EGI Financeiro',
        description: 'Gestão financeira da EGI Distribuidora',
        theme_color: '#ff4d8d',
        background_color: '#fbf9fd',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
