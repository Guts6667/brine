'use client';
import { createContext, useContext } from 'react';
const Context=createContext<{id:string;revision?:number}>({id:'initial'});
export function CampaignProvider({id,revision,children}:{id:string;revision?:number;children:React.ReactNode}){return <Context.Provider value={{id,revision}}>{children}</Context.Provider>;}
export function CampaignFields(){const {id,revision}=useContext(Context);return <><input type="hidden" name="campaignId" value={id}/>{revision!==undefined&&<input type="hidden" name="participationRevision" value={revision}/>}</>;}
