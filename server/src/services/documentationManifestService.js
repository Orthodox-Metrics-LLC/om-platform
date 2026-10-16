/**
 * OMStudio documentation authority — consumer helpers for OM workflow governance.
 * Canonical docs live in OMStudio knowledge hub; repo paths are legacy exports only.
 */

const { fetchGovernance } = require('./omstudioClient');

const FALLBACK_DOCUMENTATION = Object.freeze([
  { doc_key: 'pipeline', path: 'docs/app-workflow-catalog-pipeline.md', title: 'App Workflow Catalog Pipeline' },
  { doc_key: 'review_decisions', path: 'docs/workflow-catalog-review-implementation.md', title: 'Catalog Review Implementation' },
  { doc_key: 'phase_a_hierarchy', path: 'docs/workflow-catalog-phase-a-hierarchy-design.md', title: 'Phase A Hierarchy Design' },
  { doc_key: 'gap_analysis', path: 'docs/workflow-catalog-architecture-gap-analysis.md', title: 'Architecture Gap Analysis' },
]);

function mapWorkflowDocumentation(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.map((doc) => ({
    doc_key: doc.doc_key,
    title: doc.title,
    path: doc.legacy_repo_path || doc.path || null,
    document_id: doc.document_id || null,
    document_type: doc.document_type || 'architecture_standard',
    status: doc.status || null,
    canonical: doc.canonical !== false,
    url: doc.url || null,
    ui_url: doc.ui_url || null,
    legacy_repo_path: doc.legacy_repo_path || doc.path || null,
    authority: 'omstudio',
  }));
}

function fallbackDocumentation(reason) {
  return FALLBACK_DOCUMENTATION.map((doc) => ({
    ...doc,
    document_id: null,
    document_type: 'architecture_standard',
    status: 'legacy_export',
    canonical: false,
    url: null,
    ui_url: null,
    legacy_repo_path: doc.path,
    authority: 'repo_export',
    fallback_reason: reason || 'omstudio_unavailable',
  }));
}

/**
 * Fetch full documentation manifest from OMStudio (proxy shape).
 */
async function fetchDocumentationManifestProxy() {
  return fetchGovernance('/governance/documentation-manifest');
}

/**
 * Resolve workflow governance documentation entries from OMStudio.
 * Falls back to hardcoded repo paths when upstream is unavailable.
 */
async function resolveWorkflowDocumentation() {
  const result = await fetchDocumentationManifestProxy();
  if (!result.ok) {
    return {
      source: 'repo_export_fallback',
      available: false,
      upstream_error: result.error,
      upstream_detail: result.detail,
      documentation: fallbackDocumentation(result.error),
    };
  }

  const mapped = mapWorkflowDocumentation(result.data?.documentation);
  if (!mapped || mapped.every((d) => !d.canonical)) {
    return {
      source: 'repo_export_fallback',
      available: true,
      upstream: result.upstream,
      fetched_at: result.fetched_at,
      documentation: fallbackDocumentation('omstudio_docs_not_imported'),
    };
  }

  return {
    source: 'omstudio',
    available: true,
    upstream: result.upstream,
    fetched_at: result.fetched_at,
    schema_version: result.data?.schema_version ?? null,
    shelves: result.data?.shelves ?? [],
    goals_summary: result.data?.goals_summary ?? null,
    storage: result.data?.storage ?? null,
    documentation: mapped,
  };
}

module.exports = {
  FALLBACK_DOCUMENTATION,
  fetchDocumentationManifestProxy,
  resolveWorkflowDocumentation,
  mapWorkflowDocumentation,
  fallbackDocumentation,
};
