const PORTAL_KEY='om-viewer-portal';
export const VIEWER_COMPLETE='/auth/viewer-complete?client=om-viewer';
export function isViewerPortal(){
 if(typeof window==='undefined')return false;
 const params=new URLSearchParams(window.location.search);
 try{
  if(params.get('client')==='om-viewer'&&params.get('portal')==='1')sessionStorage.setItem(PORTAL_KEY,'1');
  return sessionStorage.getItem(PORTAL_KEY)==='1';
 }catch{return params.get('client')==='om-viewer'&&params.get('portal')==='1';}
}
export function isViewerClient(search=window.location.search){return isViewerPortal()||new URLSearchParams(search).get('client')==='om-viewer';}
