import { pkgAndBinForCurrentPlatform } from './node-platform';

import fs = require('fs');
import os = require('os');
import path = require('path');
import child_process = require('child_process');

declare const ESBUILD_VERSION: string;
const toPath = path.join(__dirname, 'bin', 'esbuild');

function validateBinaryVersion(binaryPath: string): void {
  const stdout = child_process.execFileSync(binaryPath, ['--version']).toString().trim();
  if (stdout !== ESBUILD_VERSION) {
    throw new Error(`Expected ${JSON.stringify(ESBUILD_VERSION)} but got ${JSON.stringify(stdout)}`);
  }
}

function isYarnBerryOrNewer(): boolean {
  const { npm_config_user_agent } = process.env;
  if (npm_config_user_agent) {
    const match = npm_config_user_agent.match(/yarn\/(\d+)/);
    if (match && match[1]) {
      return parseInt(match[1], 10) >= 2;
    }
  }
  return false;
}

// This package contains a "bin/esbuild" JavaScript file that finds and runs
// the appropriate binary executable. However, this means that running the
// "esbuild" command runs another instance of "node" which is way slower than
// just running the binary executable directly.
//
// Here we optimize for this by replacing the JavaScript file with the binary
// executable at install time. This optimization does not work on Windows
// because on Windows the binary executable must be called "esbuild.exe"
// instead of "esbuild". This also doesn't work with Yarn 2+ because the Yarn
// developers don't think binary modules should be used. See this thread for
// details: https://github.com/yarnpkg/berry/issues/882. This optimization also
// doesn't apply when npm's "--ignore-scripts" flag is used since in that case
// this install script will not be run.
if (os.platform() !== 'win32' && !isYarnBerryOrNewer()) {
  const { bin } = pkgAndBinForCurrentPlatform();
  fs.copyFileSync(bin, toPath);
  fs.chmodSync(toPath, 0o755);
}

// Verify that the binary is the correct version
validateBinaryVersion(toPath);
