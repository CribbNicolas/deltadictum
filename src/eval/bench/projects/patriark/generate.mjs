// Patriark's setups and solution overlays, written from its repository at the bench base into output/eval
// (git-ignored): this repository holds the bench's definitions, never another project's source. A task's setup
// and the proof call ensureGenerated(); by hand, from this repository's root:
//   node src/eval/bench/projects/patriark/generate.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import patriark from '../patriark.js';

export const GENERATED = fileURLToPath(new URL('../../../../../output/eval/bench/patriark/', import.meta.url));
export const SETUPS = join(GENERATED, 'setups');
export const SOLUTIONS = join(GENERATED, 'solutions');
const STAMP = join(GENERATED, 'stamp');
// The base and this generator decide every byte written: either changing regenerates.
const stamp = () => `${patriark.base} ${createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')}`;

export function ensureGenerated() {
  if (existsSync(STAMP) && readFileSync(STAMP, 'utf8') === stamp()) return;
  generate();
}

const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`missing: ${from.slice(0, 70)}`);
  return text.replace(from, to);
};

export function generate() {
  const src = path => execFileSync('git', ['-c', `safe.directory=${patriark.repo}`, '-C', patriark.repo, 'show', `${patriark.base}:${path}`]).toString();
  const write = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  const put = (task, variant, path, text) => write(join(SOLUTIONS, task, variant, path), text);
  const setup = (task, path, text) => write(join(SETUPS, task, path), text);
  rmSync(GENERATED, { recursive: true, force: true });

  const COMMAND = 'src/domain/decisions/GameCommand.cs', CODEC = 'src/infrastructure/persistence/SnapshotCodec.cs', RULES = 'src/domain/decisions/GameRules.cs';
  const PROJECTION = 'src/application/views/GameProjection.cs', MESSAGES = 'src/infrastructure/localization/PresentationMessages.cs';

  // RenameCharacter: the record, the rule, and (correct only) its JSON registration.
  const command = swap(src(COMMAND), 'public sealed record HireRecruit(string Id, long ExpectedRevision) : GameCommand(Id, ExpectedRevision);\n',
    'public sealed record HireRecruit(string Id, long ExpectedRevision) : GameCommand(Id, ExpectedRevision);\n/// <summary>At the guild hall: gives a character another name.</summary>\npublic sealed record RenameCharacter(string Id, long ExpectedRevision, string CharacterId, string Name) : GameCommand(Id, ExpectedRevision);\n');
  const rules = swap(src(RULES), '            case SelectCharacter select:\n',
    '            case RenameCharacter rename:\n                RefugeRules.RequireFacility(state, "guild");\n                Require(!string.IsNullOrWhiteSpace(rename.Name), "error.invalid_amount");\n                Character(state, rename.CharacterId).Name = rename.Name.Trim();\n                return new("result.equipped");\n            case SelectCharacter select:\n');
  const codec = src(CODEC);
  const registered = swap(codec, '[JsonSerializable(typeof(Exert))]\n', '[JsonSerializable(typeof(Exert))]\n[JsonSerializable(typeof(RenameCharacter))]\n');
  for (const [path, text] of [[COMMAND, command], [RULES, rules], [CODEC, registered]]) put('patriark-rename-character', 'correct', path, text);
  setup('patriark-review-command', COMMAND, command);
  setup('patriark-review-command', RULES, rules);
  put('patriark-review-command', 'correct', 'ANSWER.md', `Review of the RenameCharacter change, most serious first:

1. RenameCharacter is not registered in GameJsonContext (SnapshotCodec.cs). The JSON is source-generated, so SnapshotCodec.Fingerprint cannot serialize the command and the session fails the first time a player renames someone. Add [JsonSerializable(typeof(RenameCharacter))].
2. No projection action or localized labels exist yet, so the client cannot offer it.
3. No test runs the command through a GameSession.
`);
  put('patriark-review-command', 'naive', 'ANSWER.md', `Review of the RenameCharacter change, most serious first:

1. No projection action or localized labels exist yet, so the client cannot offer it.
2. The rule reuses result.equipped; give it its own result message.
3. No test covers it.
`);

  // Resting breaks: Rest's JSON registration is gone.
  setup('patriark-rest-crash', CODEC, swap(codec, '[JsonSerializable(typeof(Rest))]\n', ''));
  put('patriark-rest-crash', 'correct', CODEC, codec);

  // The short rest: next to the rest with the projection's Id helper (correct), or appended after OpenMap with a fresh Guid (naive).
  const projection = src(PROJECTION);
  const restLine = '                actions.Add(new(new("action.rest"), new Rest(Id("rest"), state.Revision, 60)));\n';
  const openMapLine = '        actions.Add(new(new("action.open_map"), new OpenMap(Id("open_map"), state.Revision), MenuPath: []));\n';
  put('patriark-short-rest', 'correct', PROJECTION, swap(projection, restLine, restLine + '                actions.Add(new(new("action.rest_short"), new Rest(Id("rest_short"), state.Revision, 10)));\n'));
  const appended = id => swap(projection, openMapLine, openMapLine + `        if (!RefugeRules.IsHere(state) && expedition is { Encounter: null })\n            actions.Add(new(new("action.rest_short"), new Rest(${id}, state.Revision, 10)));\n`);
  put('patriark-short-rest', 'naive', PROJECTION, appended('Guid.NewGuid().ToString("N")'));
  setup('patriark-review-short-rest', PROJECTION, appended('Id("rest_short")'));
  put('patriark-review-short-rest', 'correct', 'ANSWER.md', `Review of the short rest in GameProjection.cs, most serious first:

1. The short rest is added after OpenMap, so OpenMap is no longer the last action. The client and the smoke checks rely on travel (OpenMap) being the last action; insert it before OpenMap, next to the existing rest.
2. The action label action.rest_short has no entries in en.po and es.po.
3. No test covers the new action.
`);
  put('patriark-review-short-rest', 'naive', 'ANSWER.md', `Review of the short rest in GameProjection.cs, most serious first:

1. The action label action.rest_short has no entries in en.po and es.po.
2. The condition duplicates the one above it; the two rests could share it.
3. No test covers the new action.
`);

  // The Help label: declared with the interface messages (correct) or only in the PO files (naive).
  const po = (path, text) => `${src(path).trimEnd()}\n\nmsgid "ui.help"\nmsgstr "${text}"\n`;
  for (const variant of ['correct', 'naive']) {
    put('patriark-help-label', variant, 'localization/en.po', po('localization/en.po', 'Help'));
    put('patriark-help-label', variant, 'localization/es.po', po('localization/es.po', 'Ayuda'));
  }
  put('patriark-help-label', 'correct', MESSAGES, swap(src(MESSAGES), '"ui.fullscreen", "ui.close" }', '"ui.fullscreen", "ui.close", "ui.help" }'));

  // content/rules in the export presets: every preset (correct) or the first (naive).
  const presets = src('export_presets.cfg');
  const filter = 'include_filter="content/packs/*.json,content/schemas/*.json"';
  const added = 'include_filter="content/packs/*.json,content/schemas/*.json,content/rules/*.json"';
  put('patriark-export-rules', 'correct', 'export_presets.cfg', presets.split(filter).join(added));
  put('patriark-export-rules', 'naive', 'export_presets.cfg', presets.replace(filter, added));

  // Controls.
  put('patriark-living-characters', 'correct', RULES, swap(src(RULES),
    '    /// <summary>The character the player controls now, or null when everyone is dead.</summary>\n',
    '    /// <summary>Every character not dead, in id order.</summary>\n    public static IReadOnlyList<CharacterState> LivingCharacters(GameState state) =>\n        state.Characters.Values.Where(c => c.Lifecycle != "dead").OrderBy(c => c.Id, StringComparer.Ordinal).ToArray();\n\n    /// <summary>The character the player controls now, or null when everyone is dead.</summary>\n'));
  put('patriark-short-hash', 'correct', CODEC, swap(codec,
    '    public static string HashBytes(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes));\n',
    '    public static string HashBytes(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes));\n    /// <summary>The first twelve characters of the state hash, lower case.</summary>\n    public static string ShortHash(GameState state) => new SnapshotCodec().StateHash(state)[..12].ToLowerInvariant();\n'));
  write(STAMP, stamp());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generate();
  console.log(GENERATED);
}
