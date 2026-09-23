/** @type {import("jest").Config} **/
const config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true }],
  },
  moduleNameMapper: {
    "^\\./(index|merge)\\.js$": "<rootDir>/$1.ts",
  },
  testMatch: ["<rootDir>/**/*.test.ts"],
};

module.exports = config;
