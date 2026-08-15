/** QA personas. Not G-11. Not a login product. */
export const QA_PERSONAS = [
  { orgId: "empressa", userId: "nick", label: "Nick / Empressa" },
  { orgId: "acme", userId: "joe", label: "Joe / Acme" },
  { orgId: "acme", userId: "jane", label: "Jane / Acme" },
];

export function resolvePersona(orgId, userId) {
  const org = String(orgId || "").trim();
  const user = String(userId || "").trim();
  return QA_PERSONAS.find((p) => p.orgId === org && p.userId === user) ?? null;
}

export function actorKey(orgId, userId) {
  return `${orgId}/${userId}`;
}
