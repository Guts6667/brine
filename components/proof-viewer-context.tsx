'use client';

import {createContext, useContext, type ReactNode} from 'react';

const ProofViewerContext = createContext<(findingId: string) => void>(() => {});

export function ProofViewerProvider({openProof, children}:{openProof:(findingId:string)=>void;children:ReactNode}) {
  return <ProofViewerContext.Provider value={openProof}>{children}</ProofViewerContext.Provider>;
}

export function useProofViewer() {
  return useContext(ProofViewerContext);
}
