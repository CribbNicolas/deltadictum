export function formsList(atom) {
  const forms = atom.retrieval_forms;
  if (Array.isArray(forms)) {
    return forms.map(form => ({
      form_type: form.form_type,
      content: form.content,
      token_estimate: Number(form.token_estimate) || Math.max(1, Math.ceil(String(form.content ?? '').length / 4)),
    }));
  }
  return Object.entries(forms ?? {}).map(([form_type, content]) => ({
    form_type,
    content: String(content ?? ''),
    token_estimate: Math.max(1, Math.ceil(String(content ?? '').length / 4)),
  }));
}
