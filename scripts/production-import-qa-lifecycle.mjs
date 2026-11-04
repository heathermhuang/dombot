/** Cleanup is mandatory for normal tests. Preparation hands recovery to a durable
 * server lease. Register intent before account creation so a lost response is safe. */
export async function withProductionQa({
  start,
  test,
  cleanup,
  scrub,
  preserve,
}) {
  let lease, value;
  const errors = [];
  try {
    lease = await start((intent) => {
      lease = intent;
    });
    value = await test(lease);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      if (lease) await cleanup(lease);
    } catch (error) {
      errors.push(error);
    }
    try {
      await scrub(lease);
    } catch (error) {
      errors.push(error);
    }
    try {
      await preserve();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Production QA test or cleanup failed');
  return value;
}
