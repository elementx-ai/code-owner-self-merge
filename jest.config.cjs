/** @type {import("jest").Config} **/
const config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  moduleNameMapper: {
    "^\\./index\\.js$": "<rootDir>/index.ts",
  },
  testMatch: ["<rootDir>/**/*.test.ts"],
};

module.exports = config;
