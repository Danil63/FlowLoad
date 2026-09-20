export function revisionForSave(base, name) {
  return base?.name === name ? base.revision || null : null;
}
