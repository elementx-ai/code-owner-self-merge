import ts from "@elementx-ai/eslint-config/configs/ts.js";

export default [
  ...ts,
  {
    ignores: [
      "dist/**",
      "jest.config.cjs",
      "rollup.config.mjs",
    ],
  },
];
