export const VIEWER_COMPLETE='/auth/viewer-complete?client=om-viewer';
export function isViewerClient(search=window.location.search){return new URLSearchParams(search).get('client')==='om-viewer';}
