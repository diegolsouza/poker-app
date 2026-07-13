# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Senha da area administrativa

As paginas de administracao usam a variavel de ambiente `VITE_ADMIN_PASSWORD`.

1. Crie/edite o arquivo `.env.local` na raiz do projeto.
2. Defina: `VITE_ADMIN_PASSWORD=sua_senha`.
3. Reinicie o servidor (`npm run dev`) para aplicar.

Referencia: o arquivo `.env.example` mostra o formato da variavel.

## Publicacao no GitHub Pages

Este projeto ja esta preparado para deploy automatico com GitHub Actions.

### 1) Suba o projeto para o GitHub

Garanta que o codigo esteja no branch `main` do repositorio.

### 2) Configure o Pages para usar Actions

No GitHub:

1. Abra `Settings` do repositorio.
2. Entre em `Pages`.
3. Em `Build and deployment`, selecione `Source: GitHub Actions`.

O workflow de deploy esta em [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

### 3) Configure os secrets do Supabase no GitHub

Como o app usa variaveis `VITE_*`, adicione os secrets no repositorio:

1. `Settings` -> `Secrets and variables` -> `Actions`.
2. Crie:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_ADMIN_PASSWORD`

### 4) Publique

Ao fazer push na `main`, o GitHub executa o workflow e publica automaticamente.

URL final esperada:

`https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`

### Observacoes

- O projeto ja usa `base path` dinamico para funcionar em subpasta do GitHub Pages.
- Foi configurado fallback SPA (`404.html`) para evitar erro ao atualizar pagina em rotas como `/regras` e `/financeiro`.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
