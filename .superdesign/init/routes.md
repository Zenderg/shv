# Routes and Entry Points

This file is generated design context for Superdesign. The project does not use React Router or file-based routing. The production web app is a single Vite entry whose internal `page` state switches between Library and Queue without changing the URL.

## Production web app

| URL | Entry | Rendered view | Layout |
| --- | --- | --- | --- |
| `/` | `src/web/src/main.tsx` | Library by default; Queue is selected through app state | `App` shell with desktop sidebar/header or compact mobile header/drawer |
| `/media/:id` | Server media endpoint | Native video response, not an HTML page | Opened inside `PlayerDialog` |
| `/thumbnails/:id` | Server image endpoint | Thumbnail response, not an HTML page | Used by library cards |

## Separate design/testing surface

| URL | Entry | Purpose | Layout |
| --- | --- | --- | --- |
| `http://127.0.0.1:5174/` when explicitly started | `src/extension-preview/main.ts` | Visual harness for the injected browser-extension source sidebar | Mock source page plus real Svelte `SourceSidebar` |

The production extension UI is injected into arbitrary source pages rather than served as an app route.

## src/web/src/main.tsx

```tsx
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
```

## vite.config.ts

```ts
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/extension': 'http://127.0.0.1:8080',
      '/media': 'http://127.0.0.1:8080',
      '/thumbnails': 'http://127.0.0.1:8080'
    }
  }
});
```

## src/extension-preview/main.ts

```ts
import { mount } from 'svelte';
import PreviewApp from './PreviewApp.svelte';
import './preview.css';

mount(PreviewApp, {
  target: document.getElementById('app')!
});
```

## vite.extension-preview.config.ts

```ts
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/extension-preview',
  plugins: [svelte()],
  build: {
    outDir: '../../dist/extension-preview',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5174
  }
});
```
