# Pendientes — DD (DeltaDictum)

Actualizado 2026-09-22. Cada item tiene su referencia, no requiere contexto extra de sesión.

## 1. ~~Decidir política de auto_accept~~ — decidido 2026-09-22

Default `auto_accept: { enabled: true, confidence_threshold: 0.765 }` en `src/store/paths.js`
(filesystem × model_initiated): una propuesta del modelo con evidencia de archivo verificada
auto-acepta. Decisión explícita del usuario.

## 2. Publicar en npm

No hay `npm login` en esta máquina/entorno. Nombre `deltadictum` (sin scope) libre en el registro
(chequeado 2026-09-19). Sin esto, instalación OpenCode (`"plugin": ["deltadictum"]`) no funciona.

```bash
npm login
cd C:/dev/supermem
npm publish --dry-run   # revisar qué se va a subir
npm publish
```

## 3. Verificar Grok Build en vivo

`grok plugin validate .` pasó (schema válido, hooks y MCP servers detectados) — no confirma que el
contrato real de `PreToolUse` (payload/respuesta) funcione en una sesión real. Abrir un proyecto con
el plugin instalado, mirar si `PreToolUse` tira error.

Si falla: sacar `PreToolUse`, `UserPromptSubmit`, `PostToolUse` y `Stop` de
`.grok-plugin/plugin.json`, dejar solo `SessionStart` (fallback documentado en
`docs/integrations/grok-build.md`).

## 4. Verificar OpenCode en vivo

`opencode debug startup` corrió limpio (adapter importa sin error) — no confirma que
`experimental.chat.system.transform` inyecte contexto de DD a mitad de una conversación real. Detalle
técnico en `docs/integrations/opencode.md`.

## 5. Probar instalación real desde otro proyecto (Claude Code, Grok Build)

- **Claude Code**: `/plugin marketplace add <tu-org>/deltadictum` → `/plugin install deltadictum@deltadictum`
- **Grok Build**: equivalente con `grok plugin marketplace` / `grok plugin install`

Codex ya probado de punta a punta (paquete con `npm pack`, instalado en proyecto ajeno, instalador
corrido, `check-codex.mjs` confirmó conexión real). Los otros dos, no.

## 6. ~~Gaps 6 y 7~~ — cerrados 2026-09-22

Ver `docs/memory/roadmap.md`: `src/store/adopt.js` (gap 6) y `src/hooks/build.js` (gap 7).

## 7. Sección README "Resident process"

El aviso de SessionStart ya apunta a README > "Resident process" cuando el retrieval queda léxico. Falta
escribirla: cómo ver si el proceso residente corre (`/api/status` en la URL de `.dd/ui.json`, campo
`retrieval`), cómo arrancarlo (`node <dd>/src/cli.js ui`), cómo desactivarlo (`DD_RESIDENT=0`) y qué hacer
si falta el runtime opcional (`@huggingface/transformers`).

## 8. Fase 6 y pendientes del retrieval semántico

Ver `docs/plans/2026-09-22-semantic-retrieval-plan.md`, sección "Still open".
