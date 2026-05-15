import ts from "@elementx-ai/eslint-config/configs/ts.js";

export default [
  ...ts,
  {
    ignores: ["dist/**", "jest.config.cjs", "rollup.config.mjs"],
  },
  {
    files: ["index.ts"],
    rules: {
      "max-lines": [
        "error",
        { max: 650, skipBlankLines: true, skipComments: true },
      ],
    },
  },
];
