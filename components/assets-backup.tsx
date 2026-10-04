'use client';
import { useState } from 'react';
import JSZip from 'jszip';
import type { AssetManifest } from '@/lib/research-assets';
const LIMIT=4*1024*1024;
/** Images travel in separate bounded requests, below the hosting request-size limit. */
export async function stageBackupFile(file:File):Promise<File>{
  const magic=new Uint8Array(await file.slice(0,4).arrayBuffer()),isZip=file.name.toLowerCase().endsWith('.zip')||(magic[0]===0x50&&magic[1]===0x4b&&magic[2]===3&&magic[3]===4);
  if(!isZip){if(file.size>LIMIT)throw new Error('Le fichier JSON dépasse 4 Mio. Utilisez une archive Brine contenant ses captures séparées.');return file;}
  if(file.size>110*1024*1024)throw new Error('Archive supérieure à 110 Mio.');
  const zip=await JSZip.loadAsync(await file.arrayBuffer()),entries=Object.values(zip.files).filter(entry=>!entry.dir);
  if(entries.length>10001||entries.some(entry=>entry.name!=='brine.json'&&!/^assets\/[a-f0-9]{64}\.jpg$/.test(entry.name)))throw new Error('Cette archive n’est pas une sauvegarde Brine.');
  const jsonEntry=zip.file('brine.json');if(!jsonEntry)throw new Error('Fichier brine.json absent.');
  const uncompressed=(entry:JSZip.JSZipObject)=>Number((entry as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize||0);
  if(uncompressed(jsonEntry)>LIMIT||entries.some(entry=>entry.name!=='brine.json'&&uncompressed(entry)>102400)||entries.reduce((sum,entry)=>sum+uncompressed(entry),0)>104*1024*1024)throw new Error('Archive trop volumineuse une fois ouverte.');
  const json=await jsonEntry.async('string');if(new TextEncoder().encode(json).length>LIMIT)throw new Error('Le dossier JSON dépasse 4 Mio.');
  const parsed=JSON.parse(json),manifest:AssetManifest[]=parsed.campaignData?.assets||[];
  if(manifest.length>10000||new Set(manifest.map(asset=>asset.id)).size!==manifest.length)throw new Error('Manifeste de captures invalide.');
  for(const asset of manifest){
    if(!/^[a-f0-9]{64}$/.test(asset.id)||asset.byteLength>102400)throw new Error('Capture invalide.');
    const entry=zip.file(`assets/${asset.id}.jpg`);if(!entry)throw new Error('Une capture référencée manque dans l’archive.');
    const bytes=await entry.async('uint8array');if(bytes.byteLength!==asset.byteLength)throw new Error('La taille d’une capture ne correspond pas au manifeste.');
    const response=await fetch('/api/research-assets',{method:'POST',body:new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}),headers:{'Content-Type':'image/jpeg'}});
    const result=await response.json();if(!response.ok||result.id!==asset.id)throw new Error(result.error||'Empreinte de capture invalide.');
  }
  return new File([json],'brine.json',{type:'application/json'});
}
export function DownloadAssetBackup(){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function download(){setBusy(true);setError('');try{
    const response=await fetch('/api/backup');if(!response.ok)throw new Error('Sauvegarde indisponible.');
    const text=await response.text(),backup=JSON.parse(text),zip=new JSZip();zip.file('brine.json',text);
    for(const asset of (backup.campaignData?.assets||[]) as AssetManifest[]){const image=await fetch(`/api/research-assets/${asset.id}`);if(!image.ok)throw new Error('Une capture privée manque. La sauvegarde complète n’a pas été créée.');zip.file(`assets/${asset.id}.jpg`,await image.arrayBuffer());}
    const blob=await zip.generateAsync({type:'blob',compression:'STORE'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`brine-${new Date().toISOString().slice(0,10)}.zip`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){setError(error instanceof Error?error.message:'Sauvegarde impossible.');}finally{setBusy(false);}}
  return <><button type="button" className="button primary" onClick={download} disabled={busy}>{busy?'Création de l’archive…':'Télécharger la sauvegarde complète (ZIP)'}</button><p className="field-help">Dossiers, qualifications, bilans et captures privées. Les images sont conservées une seule fois.</p>{error&&<p className="form-error" role="alert">{error}</p>}</>;
}
