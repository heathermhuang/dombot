// Whitelist only diagnostic fields; never retain API bodies or provider messages.
export function setupFailureReceipt(method, status, reference, diagnostic) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const phases = new Set([
    'admission',
    'assets',
    'database-inspection',
    'database-create',
    'module-read',
    'worker-inspection',
    'worker-upload',
    'bootstrap',
    'provenance',
    'idle-qualification',
    'complete',
  ]);
  const result = {
    method: 'POST',
    stage: method === 'importDomains' ? 'import-submission' : 'tenant-api',
    status,
  };
  if (typeof reference === 'string' && uuid.test(reference))
    result.supportReference = reference;
  if (diagnostic && phases.has(diagnostic.phase)) {
    result.phase = diagnostic.phase;
    if (uuid.test(diagnostic.operationId ?? ''))
      result.operationId = diagnostic.operationId;
    if (
      [
        'in_progress',
        'qualified',
        'outcome_pending',
        'artifact_timeout',
        'setup_failed',
      ].includes(diagnostic.code)
    )
      result.code = diagnostic.code;
    if (
      Number.isInteger(diagnostic.status) &&
      diagnostic.status >= 100 &&
      diagnostic.status <= 599
    )
      result.upstreamStatus = diagnostic.status;
    if (/^[a-f0-9]{16}-[A-Z0-9]{3}$/.test(diagnostic.upstreamReference ?? ''))
      result.upstreamReference = diagnostic.upstreamReference;
    const qualification = diagnostic.qualification;
    if (
      qualification &&
      [
        'matched',
        'http_error',
        'provenance_mismatch',
        'dispatch_failed',
      ].includes(qualification.outcome)
    ) {
      result.qualification = { outcome: qualification.outcome };
      for (const key of [
        'enginePresent',
        'engineMatches',
        'sourcePresent',
        'sourceMatches',
      ])
        if (typeof qualification[key] === 'boolean')
          result.qualification[key] = qualification[key];
    }
  }
  return result;
}
