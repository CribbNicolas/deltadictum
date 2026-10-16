// Patriark's candidate tasks (docs/superpowers/plans/2026-10-16-bench-05-patriark.md), at the base commit,
// on the project's real store. Hidden xUnit classes decide the runtime ones; static checks the rest.
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changed, detail, flags } from '../fixture-checks.js';
import { addedCs, dotnetHidden } from './checks.js';

// A setup's files are Patriark's own source, generated from its repository (generate.mjs), never kept here.
const overlay = name => async dir => {
  const { ensureGenerated, SETUPS } = await import('./generate.mjs');
  ensureGenerated();
  cpSync(join(SETUPS, name), dir, { recursive: true });
};
const read = (dir, path) => { try { return readFileSync(join(dir, path), 'utf8'); } catch { return ''; } };

async function hidden(dir, { file, pass, requirements = {} }) {
  const tests = [...new Set([...pass, ...Object.values(requirements)])];
  const run = await dotnetHidden(dir, { file, tests });
  return { passed: pass.every(name => run.results[name]), results: run.results, out: run.out,
    requirements: Object.fromEntries(Object.entries(requirements).map(([id, name]) => [id, run.results[name]])) };
}
const report = (run, extra = {}) => detail({ ...run.results, ...extra, ...(run.passed ? {} : { output: run.out.slice(-600).replace(/\s+/g, ' ') }) });
const reviewed = async (dir, answer) => answer.trim().length > 40 && !(await addedCs(dir, 'src/')).trim();

export const TASKS = [
  {
    id: 'patriark-rename-character', project: 'patriark', situation: 'S2', origin: 'authored', kind: 'memory',
    memories: ['persistence/serialization/source-gen-and-strict-json', 'session/commands/add-command-checklist'],
    prompt: 'Add a `RenameCharacter(Id, ExpectedRevision, CharacterId, Name)` command, accepted at the guild hall, that gives a character another name.',
    requirements: [{ id: 'runs_in_a_session', auto: true, text: 'The command runs through a GameSession and the name survives a reload.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'ZzBenchRename.cs', pass: ['RenamesAtTheGuildAndKeepsItOnReload'], requirements: { runs_in_a_session: 'RenamesAtTheGuildAndKeepsItOnReload' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'patriark-rest-crash', project: 'patriark', situation: 'S7', origin: 'authored', kind: 'memory',
    memories: ['persistence/serialization/source-gen-and-strict-json'], setup: overlay('patriark-rest-crash'), setupMessage: 'Tidy the JSON context',
    prompt: 'Resting on an expedition started failing after the last change. Can you look?',
    requirements: [{ id: 'rest_runs', auto: true, text: 'Rest runs through a GameSession again.' }],
    async check(dir) {
      const run = await hidden(dir, { file: 'ZzBenchRest.cs', pass: ['RestsOnAnExpedition'], requirements: { rest_runs: 'RestsOnAnExpedition' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'patriark-short-rest', project: 'patriark', situation: 'S8', origin: 'authored', kind: 'memory',
    memories: ['session/commands/atomic-idempotent', 'views/openmap-last-action'],
    prompt: 'Add a short rest (10 minutes) action next to the existing rest at expedition nodes.',
    requirements: [
      { id: 'stable_id', auto: true, text: 'The action\'s command id comes from the projection\'s Id helper: the same on every projection of a revision.' },
      { id: 'open_map_last', auto: true, text: 'OpenMap stays the last action.' },
    ],
    async check(dir) {
      const run = await hidden(dir, { file: 'ZzBenchShortRest.cs', pass: ['OffersAShortRest'], requirements: { stable_id: 'ShortRestIdIsStable', open_map_last: 'OpenMapStaysLast' } });
      return { passed: run.passed, requirements: run.requirements, detail: report(run) };
    },
  },
  {
    id: 'patriark-help-label', project: 'patriark', situation: 'S12', origin: 'authored', kind: 'memory',
    memories: ['localization/ui/contracts-outside-simulation'],
    prompt: 'Add an interface label `ui.help` that reads "Help" in English and "Ayuda" in Spanish, for a Help button in the client\'s main menu.',
    requirements: [{ id: 'outside_pack', auto: true, text: 'The label is declared in PresentationMessages and the content pack is not touched.' }],
    async check(dir) {
      const po = (file, text) => new RegExp(`msgid "ui\\.help"\\s*\\nmsgstr "${text}"`).test(read(dir, file).replaceAll('\r', ''));
      const passed = po('localization/en.po', 'Help') && po('localization/es.po', 'Ayuda');
      const declared = /"ui\.help"/.test(read(dir, 'src/infrastructure/localization/PresentationMessages.cs'));
      const packUntouched = !(await changed(dir, 'content/packs/prototype-9.json')) && !(await addedCs(dir, 'content/')).trim();
      return { passed, requirements: { outside_pack: declared && packUntouched }, detail: detail({ 'po entries': passed, declared, 'pack untouched': packUntouched }) };
    },
  },
  {
    id: 'patriark-export-rules', project: 'patriark', situation: 'S3', origin: 'authored', kind: 'memory',
    memories: ['build/export/include-filter'],
    prompt: 'The client will now load JSON files from `content/rules/` at runtime. Make sure the exported builds ship them.',
    requirements: [{ id: 'every_preset', auto: true, text: 'Every export preset\'s include_filter lists content/rules.' }],
    async check(dir) {
      const filters = [...read(dir, 'export_presets.cfg').matchAll(/^include_filter="([^"]*)"/gm)].map(m => m[1]);
      const ships = filters.map(f => /content\/rules\//.test(f));
      return { passed: ships.some(Boolean), requirements: { every_preset: ships.length > 0 && ships.every(Boolean) }, detail: detail({ presets: filters.length, shipping: ships.filter(Boolean).length }) };
    },
  },
  {
    id: 'patriark-review-command', project: 'patriark', situation: 'S18', origin: 'authored', kind: 'memory',
    memories: ['persistence/serialization/source-gen-and-strict-json'], setup: overlay('patriark-review-command'), setupMessage: 'Rename characters at the guild',
    prompt: 'A teammate added the RenameCharacter command in the last commit. Review it before it ships: list the problems you find, most serious first. Do not change any code.',
    requirements: [{ id: 'flags_serialization', auto: true, text: 'The review names that the command is not registered for the source-generated JSON.' }],
    async check(dir, answer) {
      const passed = await reviewed(dir, answer);
      const flagged = flags(answer, /\b(JsonSerializable|GameJsonContext|source[- ]?generat\w*|seriali[sz]\w*)\b/i);
      return { passed, requirements: { flags_serialization: flagged }, detail: detail({ reviewed: passed, 'flags serialization': flagged }) };
    },
  },
  {
    id: 'patriark-review-short-rest', project: 'patriark', situation: 'S18', origin: 'authored', kind: 'memory',
    memories: ['views/openmap-last-action'], setup: overlay('patriark-review-short-rest'), setupMessage: 'Short rest action',
    prompt: 'A teammate added a short rest action in GameProjection.cs in the last commit. Review it before it ships: list the problems you find, most serious first. Do not change any code.',
    requirements: [{ id: 'flags_order', auto: true, text: 'The review names that OpenMap is no longer the last action.' }],
    async check(dir, answer) {
      const passed = await reviewed(dir, answer);
      const flagged = flags(answer, /\b(OpenMap|open[_ ]map|travel)\b/i, /\b(last|after)\b/i);
      return { passed, requirements: { flags_order: flagged }, detail: detail({ reviewed: passed, 'flags the order': flagged }) };
    },
  },
  {
    id: 'patriark-living-characters', project: 'patriark', situation: 'S11', origin: 'authored', kind: 'control', memories: [],
    prompt: 'Add `GameRules.LivingCharacters(GameState state)` returning the characters that are not dead, ordered by id.',
    requirements: [],
    async check(dir) {
      const run = await hidden(dir, { file: 'ZzBenchLiving.cs', pass: ['LivingCharactersSkipTheDeadInIdOrder'] });
      return { passed: run.passed, requirements: {}, detail: report(run) };
    },
  },
  {
    id: 'patriark-short-hash', project: 'patriark', situation: 'S11', origin: 'authored', kind: 'control', memories: [],
    prompt: 'Add `SnapshotCodec.ShortHash(GameState state)` returning the first twelve characters of the state hash, in lower case.',
    requirements: [],
    async check(dir) {
      const run = await hidden(dir, { file: 'ZzBenchShortHash.cs', pass: ['ShortHashIsTheStateHashPrefix'] });
      return { passed: run.passed, requirements: {}, detail: report(run) };
    },
  },
];
