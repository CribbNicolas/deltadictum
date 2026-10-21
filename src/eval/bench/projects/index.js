// The bench's projects. Each project's module is imported here. Patriark is a separate repository: it joins the
// registry only on a machine that has it.
import ledgerkit from './ledgerkit.js';
import patriark, { available as patriarkAvailable } from './patriark.js';
import supermem from './supermem.js';
import tollgate from './tollgate.js';

export const PROJECTS = [tollgate, ledgerkit, supermem, ...(patriarkAvailable ? [patriark] : [])];
