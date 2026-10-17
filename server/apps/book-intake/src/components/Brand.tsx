import { useAppTheme } from '../theme/ThemeProvider';
export function OMLogo({wordmark=false,className=''}:{wordmark?:boolean;className?:string}){
    const {theme}=useAppTheme();
    const source=new URL(`brand/om-${wordmark?'wordmark':'monogram'}-${theme==='dark'?'white':'green'}.png`,document.baseURI).href;
    return <img className={`om-logo ${wordmark?'wordmark':'monogram'} ${className}`} src={source} alt={wordmark?'Orthodox Metrics':'OM'} width={wordmark?210:106} height={44}/>;
}
export function ThemeToggle(){
    const {theme,toggle}=useAppTheme();
    return <button className="theme-toggle" aria-label={`Switch to ${theme==='dark'?'light':'dark'} mode`} title={`Switch to ${theme==='dark'?'light':'dark'} mode`} aria-pressed={theme==='dark'} onClick={toggle}><span aria-hidden="true">{theme==='dark'?'☀':'☾'}</span><span>{theme==='dark'?'Light':'Dark'}</span></button>;
}
export function ApplicationCopyright({compact=false}:{compact?:boolean}){
    return <div className={`application-copyright ${compact?'compact':''}`}><span>© {new Date().getFullYear()} Orthodox Metrics · OM Daily Reading application v0.4</span>{!compact&&<span>Application software and branding only. No copyright is claimed over imported book content.</span>}</div>;
}
