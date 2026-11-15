// Settings for Vite. Vite reads this file when you run `npm run dev`.
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default {
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        mvp: resolve(root, 'mvp.html'),
      },
    },
  },
  server: {
    // While developing, the website runs on port 5173 (Vite) and the API runs
    // on port 3000 (Express). The proxy makes Vite pass these requests on to
    // Express, so client code can call `/search` without knowing the port.
    //
    // Adding a new server route (/analyse, /narrate, /ambience)? Add a line
    // here too, or the browser will not be able to reach it in development.
    //
    // This only applies in development.
    proxy: {
      '/search': 'http://localhost:3000',
      '/audio': 'http://localhost:3000',
      '/analyse': 'http://localhost:3000',
      '/narrate': 'http://localhost:3000',
    },
  },
};
