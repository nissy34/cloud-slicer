#!/usr/bin/env node
// Packs the built server (dist/, from build.mjs) for people to install:
//   release/cloud-slicer.mcpb       Claude Desktop extension: download, double-click, Install.
//                                   Claude Desktop runs it with the Node it ships with.
//   release/cloud-slicer-mcp.tgz    for Claude Code and other MCP apps:
//                                   claude mcp add cloud-slicer -- npx -y <link to the .tgz>
// Everything is bundled: neither needs npm packages at install time.
// CI puts both on the "mcp" GitHub release on every push to main (ci.yml, mcp job).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { version, description, license } = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8'));
const out = resolve(here, 'release');
const stage = resolve(out, 'stage');
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(resolve(here, 'dist'), resolve(stage, 'dist'), { recursive: true });
cpSync(resolve(here, '../web/public/icons/icon-512.png'), resolve(stage, 'icon.png'));
cpSync(resolve(here, '../../LICENSE'), resolve(stage, 'LICENSE'));

// What npx installs: no dependencies, the server is the program.
writeFileSync(
  resolve(stage, 'package.json'),
  JSON.stringify({ name: 'cloud-slicer-mcp', version, description, license, type: 'module', bin: { 'cloud-slicer-mcp': 'dist/server.mjs' }, engines: { node: '>=20' } }, null, 2) + '\n',
);

// Claude Desktop extension manifest (MCPB format).
writeFileSync(
  resolve(stage, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: '0.3',
      name: 'cloud-slicer',
      display_name: 'Cloud Slicer',
      version,
      description: 'Slice 3D models for your printer on this computer, with OrcaSlicer.',
      long_description:
        'Lets Claude open STL and 3MF files, choose printer, process and filament presets, change settings, ' +
        'arrange objects and slice, and tells you the print time and filament use. Uses the same engines and ' +
        'presets as https://slicer.awesomestuff.qzz.io (Snapmaker Orca 2.4.1 and OrcaSlicer 2.4.2). Slicing stays on this computer; signing in to your Cloud Slicer account is optional.',
      author: { name: 'Cloud Slicer', url: 'https://slicer.awesomestuff.qzz.io' },
      homepage: 'https://slicer.awesomestuff.qzz.io',
      repository: { type: 'git', url: 'https://github.com/nissy34/cloud-slicer' },
      license,
      icon: 'icon.png',
      server: {
        type: 'node',
        entry_point: 'dist/server.mjs',
        mcp_config: { command: 'node', args: ['${__dirname}/dist/server.mjs'] },
      },
      tools_generated: true,
      keywords: ['3d printing', 'slicer', 'orcaslicer', 'gcode'],
      compatibility: { runtimes: { node: '>=20.0.0' } },
    },
    null,
    2,
  ) + '\n',
);

const mcpb = resolve(here, 'node_modules/.bin/mcpb');
execFileSync(mcpb, ['validate', resolve(stage, 'manifest.json')], { stdio: 'inherit' });
execFileSync(mcpb, ['pack', stage, resolve(out, 'cloud-slicer.mcpb')], { stdio: 'inherit' });
rmSync(resolve(stage, 'manifest.json'));
rmSync(resolve(stage, 'icon.png'));
const tgz = execFileSync('npm', ['pack', '--silent', '--pack-destination', out], { cwd: stage, encoding: 'utf8' }).trim().split('\n').at(-1);
renameSync(resolve(out, tgz), resolve(out, 'cloud-slicer-mcp.tgz'));
rmSync(stage, { recursive: true, force: true });
console.log(`packed ${out}/cloud-slicer.mcpb and cloud-slicer-mcp.tgz`);
