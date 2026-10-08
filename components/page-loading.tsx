type SkeletonProps={variant?:'dashboard'|'cards'|'list'|'detail';compact?:boolean};

export function PageLoadingSkeleton({variant='list'}:SkeletonProps){
  const cards=variant==='cards'?3:variant==='detail'?2:4;
  return <div className={`page-skeleton page-skeleton-${variant}`} role="status" aria-label="Chargement de la page">
    <span className="sr-only">Chargement…</span>
    <div className="page-skeleton-heading" aria-hidden="true"><span/><strong/><i/></div>
    <div className="page-skeleton-tabs" aria-hidden="true"><span/><span/><span/></div>
    <div className="page-skeleton-grid" aria-hidden="true">{Array.from({length:cards},(_,index)=><div className="page-skeleton-card" key={index}><strong/><span/><span/><i/></div>)}</div>
  </div>;
}

export function SectionLoadingSkeleton({compact=false}:{compact?:boolean}){
  return <div className={`section-loading-skeleton${compact?' compact':''}`} role="status" aria-label="Chargement du contenu">
    <span className="sr-only">Chargement…</span>
    <div aria-hidden="true"><strong/><span/><span/></div><div aria-hidden="true"><strong/><span/></div>
  </div>;
}
