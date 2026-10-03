'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <div className="empty-state"><h1>La page n’a pas pu être chargée.</h1><p>Vos données sont conservées. Réessayez dans un instant.</p><button className="button primary" onClick={reset}>Réessayer</button></div>;}
