// eslint.config.js
import js from "@eslint/js";
import tsplugin from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import path from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default [
  // 無視パターン
  { ignores: ["node_modules", "dist", "build", "coverage"] },

  // JS の推奨
  js.configs.recommended,

  // TS 用（型情報あり）
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        // ★ Windows でも確実に絶対パスに
        project: path.join(__dirname, "tsconfig.json"),
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: { "@typescript-eslint": tsplugin },
    rules: {
      // plugin の recommended を取り込む
      ...tsplugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off", // ここはお好みで
    },
  },

  // Prettier と競合するルールを無効化
  prettier,
];
