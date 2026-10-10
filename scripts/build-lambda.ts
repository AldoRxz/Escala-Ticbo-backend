/**
 * Packages the API for AWS Lambda: one minified ESM bundle (fast cold starts)
 * plus the native Argon2 binary for Amazon Linux on the target architecture.
 *
 *   npm run build:lambda                  arm64 (Graviton: cheaper per GB-second)
 *   npm run build:lambda -- --arch=x64
 *
 * Output: dist-lambda/api, with handler `index.handler`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const arch = process.argv.find((arg) => arg.startsWith('--arch='))?.split('=')[1] ?? 'arm64';
if (arch !== 'arm64' && arch !== 'x64') {
  console.error(`Unsupported --arch=${arch}; use arm64 or x64.`);
  process.exit(1);
}

const outdir = 'dist-lambda/api';
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await build({
  // Bundle the tsc output, not the sources: esbuild cannot emit the decorator
  // metadata Nest's dependency injection relies on, tsc already did.
  entryPoints: ['dist/lambda.js'],
  outfile: `${outdir}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  // Nest and our errors read class names at runtime.
  keepNames: true,
  sourcemap: 'external',
  legalComments: 'none',
  // CommonJS dependencies inside an ESM bundle still call require().
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  external: [
    // Native binary, installed below for the target platform.
    '@node-rs/argon2',
    // Optional integrations Nest and Fastify load only if installed.
    '@nestjs/microservices',
    '@nestjs/microservices/*',
    '@nestjs/websockets',
    '@nestjs/websockets/*',
    '@nestjs/platform-express',
    'class-transformer',
    'class-validator',
    '@fastify/static',
    '@fastify/view',
    '@fastify/multipart',
    'pg-native',
  ],
});

const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>;
};
writeFileSync(
  `${outdir}/package.json`,
  JSON.stringify(
    {
      type: 'module',
      private: true,
      dependencies: { '@node-rs/argon2': dependencies['@node-rs/argon2'] },
    },
    null,
    2,
  ),
);
const installArgs = [
  'install',
  '--omit=dev',
  '--no-package-lock',
  '--no-audit',
  '--no-fund',
  '--os=linux',
  `--cpu=${arch}`,
  '--libc=glibc',
];
// Under `npm run`, call npm's own CLI with node: no shell needed on Windows.
const npmCli = process.env.npm_execpath;
if (npmCli) {
  execFileSync(process.execPath, [npmCli, ...installArgs], { cwd: outdir, stdio: 'inherit' });
} else {
  execFileSync('npm', installArgs, {
    cwd: outdir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const bundleKb = Math.round(statSync(`${outdir}/index.mjs`).size / 1024);
console.log(`Lambda package ready in ${outdir} (linux-${arch}, bundle ${bundleKb} KB).`);
