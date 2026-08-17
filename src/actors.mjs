/** QA personas. Not G-11. Not a login product. */
export const QA_PERSONAS = [
  { orgId: "empressa", userId: "nick", label: "Nick / Empressa" },
  { orgId: "acme", userId: "joe", label: "Joe / Acme" },
  { orgId: "acme", userId: "jane", label: "Jane / Acme" },
  { orgId: "icc-demo", userId: "reviewer", label: "Empressa reviewer / icc-demo" },
  { orgId: "icc-demo", userId: "observer", label: "ICC observer / icc-demo" },
  { orgId: "template-city", userId: "g71-calendar", label: "Template city clerk / calendar" },
];

export function resolvePersona(orgId, userId) {
  const org = String(orgId || "").trim();
  const user = String(userId || "").trim();
  return QA_PERSONAS.find((p) => p.orgId === org && p.userId === user) ?? null;
}

export function actorKey(orgId, userId) {
  return `${orgId}/${userId}`;
}
