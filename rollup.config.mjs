import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

import { builtinModules } from "node:module";

const external = new Set([
  ...builtinModules,
  ...builtinModules.map((mod) => `node:${mod}`),
]);

export default {
  input: "index.ts",
  output: {
    file: "dist/index.mjs",
    format: "es",
    sourcemap: false,
  },
  external: (id) => external.has(id),
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ["node"] }),
    commonjs(),
    json(),
    typescript({ tsconfig: "./tsconfig.json" }),
  ],
};
