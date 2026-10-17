(() => {
 const churchId=new URL(location.href).searchParams.get('churchId');
 const originalFetch=window.fetch.bind(window);
 const session=originalFetch('/api/om-apps/session').then(async r=>{if(r.status===401){location.href='/auth/login';throw Error('Sign in required.');}const result=await r.json();if(!r.ok)throw Error(result.error);return result.result;});
 window.fetch=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:input,location.href);
  if(url.origin===location.origin&&url.pathname.startsWith('/api/'))url.pathname='/apps/books'+url.pathname;
  if(url.origin!==location.origin||!url.pathname.startsWith('/apps/books/api/'))return originalFetch(input,init);
  if(churchId)url.searchParams.set('churchId',churchId);
  const s=await session,headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers).forEach((v,k)=>headers.set(k,v));
  headers.set('X-OM-Apps-CSRF',s.csrf);headers.set('X-OM-Reader','1');
  const response=await originalFetch(input instanceof Request?new Request(url,input):url,{...init,headers});
  if(response.status===401)location.href='/auth/login';return response;
 };
 window.addEventListener('om-session-expired',()=>location.href='/auth/login');
 document.addEventListener('DOMContentLoaded',()=>{const nav=document.createElement('a');nav.href='/apps/';nav.textContent='← OM Applications';nav.style.cssText='display:block;padding:12px 24px;background:#141a21;color:#78deb4';document.body.prepend(nav);});
})();
