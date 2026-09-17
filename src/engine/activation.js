import { contentTokens, triggerActivationScore } from './v4/trigger-match.js';

// A small transparent concept vocabulary complements project-authored variants.
// This is not a semantic model: unknown terminology still requires aliases/context.
const GROUPS = [
  ['retry', 'retries', 'retrying', 'reintentar', 'reintentos', 'reintento', 'reenviar'],
  ['payment', 'payments', 'pago', 'pagos', 'cobro', 'cobros', 'charge', 'charges'],
  ['migration', 'migrations', 'migracion', 'migraciones'],
  ['database', 'db', 'base', 'datos'], ['test', 'tests', 'testing', 'prueba', 'pruebas'],
  ['write', 'writing', 'escribir', 'escritura', 'guardar'], ['edit', 'editing', 'modify', 'modificar', 'editar', 'cambiar'],
  ['memory', 'memories', 'memoria', 'memorias'], ['durable', 'persistent', 'persistente'],
  ['install', 'installing', 'instalar', 'instalacion'], ['deploy', 'deployment', 'desplegar', 'despliegue'],
  ['error', 'failure', 'failures', 'failing', 'fallo', 'fallos', 'falla'],
  ['idempotency', 'idempotent', 'idempotencia', 'idempotente'],
  ['key', 'keys', 'clave', 'claves'], ['request', 'requests', 'solicitud', 'solicitudes'],
  ['timeout', 'timeouts', 'espera'], ['component', 'components', 'componente', 'componentes'],
];
const CONCEPT = new Map(GROUPS.flatMap(group => group.map(word => [word, group[0]])));
const ES_STOP = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'en', 'al', 'un', 'una', 'cuando', 'antes', 'despues', 'para', 'por', 'con', 'que', 'se']);
export function conceptTokens(value) {
  return [...new Set(contentTokens(value).filter(t => !ES_STOP.has(t)).map(t => CONCEPT.get(t) ?? t))];
}
export function searchableTrigger(atom) {
  const text = [atom.trigger, ...(atom.trigger_variants ?? []), ...(atom.applies_to?.files ?? []),
    ...(atom.applies_to?.components ?? []), ...(atom.applies_to?.operations ?? [])].join(' ');
  return `${text} ${conceptTokens(text).join(' ')}`;
}
export function matchesGlob(file, glob) {
  const normalized = String(file).replaceAll('\\', '/').replace(/^\.\//, '');
  const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]').replaceAll('\u0000', '(?:.*/)?').replaceAll('\u0001', '.*');
  return new RegExp(`^${escaped}$`, 'i').test(normalized);
}

export function assessApplicability(atom, request, now = Date.now()) {
  if (Date.parse(atom.valid_from) > now || (atom.valid_until && Date.parse(atom.valid_until) <= now)) return { applies: false };
  const warnings = [];
  const constraints = [];
  let contextScore = 0;
  const scope = atom.applies_to ?? {};
  for (const kind of ['files', 'components', 'operations']) {
    if (!scope[kind]?.length) continue;
    const incoming = kind === 'operations' ? (request.operation ? [request.operation] : []) : request[kind] ?? [];
    const matches = incoming.some(value => scope[kind].some(expected => kind === 'files' ? matchesGlob(value, expected)
      : kind === 'operations' ? conceptTokens(value).join(' ') === conceptTokens(expected).join(' ') : value.toLowerCase() === expected.toLowerCase()));
    if (incoming.length && !matches) return { applies: false };
    if (matches) contextScore = Math.max(contextScore, 0.8);
    constraints.push(`${kind}: ${scope[kind].join(', ')}`);
  }
  for (const a of atom.assumptions ?? []) {
    const value = a.key ? request.facts?.[a.key] : undefined;
    if (a.key && value !== undefined && value !== a.equals) return { applies: false };
    constraints.push(a.description || a.key);
    if (value === undefined) warnings.push(`verify assumption: ${a.description || a.key}`);
  }
  const revisions = [];
  for (const condition of atom.revisit_when ?? []) {
    if (condition.kind === 'date' && Date.parse(condition.date) <= now) revisions.push(condition.description);
    if (condition.kind === 'fact_changed' && request.facts?.[condition.key] !== undefined && request.facts[condition.key] !== condition.equals) revisions.push(condition.description);
    if (condition.kind === 'manual' || condition.kind === 'date') constraints.push(`reconsider when ${condition.description}`);
    if (condition.kind === 'fact_changed' && request.facts?.[condition.key] === undefined) warnings.push(`verify revision condition: ${condition.description}`);
  }
  return { applies: true, warnings, constraints, revisions, contextScore };
}

export function activationScore(atom, action, contextScore = 0) {
  const actionConcepts = new Set(conceptTokens(action));
  const scores = [atom.trigger, ...(atom.trigger_variants ?? [])].map(trigger => {
    const tokens = conceptTokens(trigger);
    const overlap = tokens.filter(t => actionConcepts.has(t)).length / Math.max(1, tokens.length);
    return Math.max(triggerActivationScore(action, trigger), overlap);
  });
  return Math.max(...scores, contextScore);
}
