'use strict';

const { pathToFileURL } = require('node:url');
const { join } = require('node:path');

const command = process.argv[2] || 'session-start';
const target = join(__dirname, '..', 'src', 'hooks', 'run.js');
process.argv = [process.execPath, target, command];
import(pathToFileURL(target).href).catch(() => process.exit(0));
