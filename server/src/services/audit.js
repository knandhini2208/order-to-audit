// Records who changed what and when. BigInt values are stored as strings.
export async function logAudit(client, { userId = null, entity, entityId, action, before = null, after = null }) {
  const json = (v) => (v == null ? null : JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x)));
  await client.query(
    `INSERT INTO audit_log (user_id, entity, entity_id, action, before, after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, entity, entityId, action, json(before), json(after)]
  );
}