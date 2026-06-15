import eslintPluginAstro from "eslint-plugin-astro";
import tsParser from "@typescript-eslint/parser";

export default [
  ...eslintPluginAstro.configs.recommended,
  {
    ignores: [
      "dist/**",
      ".astro/**",
      "node_modules/**",
      "public/pagefind/**",
      "public/search-vectors.json",
      "public/assets/graph/graph-data.json",
      "src/redirects.generated.json",
      "search-service/.venv/**",
      "reports/**",
    ],
  },
  {
    files: ["**/*.astro"],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
    },
  },
  { rules: { "no-console": ["error", { allow: ["warn", "error"] }] } },
  {
    files: ["scripts/**/*.mjs", "cms-auth/**/*.mjs"],
    rules: { "no-console": "off" },
  },
];
