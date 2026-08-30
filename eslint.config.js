"use strict";

// Model.js is loaded two ways: by QML via `import "Model.js" as Model`, and by
// Node via `require` in the tests. That is why it is plain ES5-style script
// code with a guarded `module.exports` tail rather than an ES module — the QML
// engine has no module loader. The rules below keep that contract enforceable
// instead of relying on everyone remembering it.
module.exports = [
  {
    ignores: ["node_modules/**", "coverage/**"],
  },
  {
    files: ["Model.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: { module: "writable" },
    },
    rules: {
      "no-undef": "error",
      // `catch (e)` stays even when unused: QML's engine predates optional
      // catch binding, so dropping the parameter would be a syntax error there.
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
      // Top-level declarations are the whole point of a QML JS resource --
      // `import "Model.js" as Model` exposes exactly the globals this file
      // declares, so wrapping them in an IIFE would empty the module.
      "no-implicit-globals": "off",
      eqeqeq: ["error", "always"],
      curly: ["error", "multi-line"],
      // `var` and function declarations are deliberate: this file has to parse
      // in both QML's JS engine and Node.
      "no-var": "off",
      "prefer-const": "off",
    },
  },
  {
    files: ["test/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "error",
      eqeqeq: ["error", "always"],
    },
  },
];
