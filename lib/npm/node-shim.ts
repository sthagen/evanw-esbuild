#!/usr/bin/env node

import { pkgAndBinForCurrentPlatform } from "./node-platform";
import child_process = require('child_process');

const { bin } = pkgAndBinForCurrentPlatform();
child_process.execFileSync(bin, process.argv.slice(2), { stdio: 'inherit' });
