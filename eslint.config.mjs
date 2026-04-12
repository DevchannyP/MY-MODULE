import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["domains/**/*.js", "src/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Promise: "readonly",
        Error: "readonly",
        Map: "readonly",
        Set: "readonly",
        Date: "readonly",
        JSON: "readonly",
        Object: "readonly",
        Array: "readonly",
        Math: "readonly",
        Symbol: "readonly",
        crypto: "readonly",
        URL: "readonly",
        fetch: "readonly",
        globalThis: "readonly",
      },
    },
    rules: {
      // 오류 방지
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-undef": "error",

      // 코드 품질
      "eqeqeq": ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",

      // 도메인 코어 순수성 보조 (C002)
      "no-console": "warn",

      // 생성형 스크립트의 복잡한 regex 이스케이프 허용 (false-positive 방지)
      "no-useless-escape": "warn",
    },
  },
  {
    // 테스트 파일: node:test globals 허용
    files: ["domains/**/tests/**/*.js"],
    languageOptions: {
      globals: {
        test: "readonly",
        describe: "readonly",
        it: "readonly",
        before: "readonly",
        after: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
];
