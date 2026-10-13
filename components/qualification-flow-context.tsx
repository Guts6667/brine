'use client';

import {createContext,useContext} from 'react';

const QualificationSavedContext=createContext<(()=>void)|null>(null);

export const QualificationSavedProvider=QualificationSavedContext.Provider;
export function useQualificationSaved(){return useContext(QualificationSavedContext);}
