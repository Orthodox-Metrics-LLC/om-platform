import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export type AppTheme='light'|'dark';
const KEY='om-daily-reading-theme-v1';
function initial():AppTheme{
    try{const s=localStorage.getItem(KEY);if(s==='dark'||s==='light')return s;}catch{}
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
}
function apply(theme:AppTheme){
    document.documentElement.dataset.appTheme=theme;document.documentElement.style.colorScheme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#141a21':'#ffffff');
}
const Context=createContext<{theme:AppTheme;setTheme:(t:AppTheme)=>void;toggle:()=>void}>({theme:'light',setTheme:()=>{},toggle:()=>{}});
export function ThemeProvider({children}:{children:ReactNode}){
    const [theme,set]=useState<AppTheme>(initial);
    const setTheme=(value:AppTheme)=>{apply(value);set(value);try{localStorage.setItem(KEY,value);}catch{}};
    useEffect(()=>{apply(theme);},[theme]);
    useEffect(()=>{
        const sync=(e:StorageEvent)=>{if(e.key===KEY&&(e.newValue==='light'||e.newValue==='dark')){apply(e.newValue);set(e.newValue);}};
        window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
    },[]);
    return <Context.Provider value={{theme,setTheme,toggle:()=>setTheme(theme==='dark'?'light':'dark')}}>{children}</Context.Provider>;
}
export const useAppTheme=()=>useContext(Context);
