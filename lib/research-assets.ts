import { createHash } from 'node:crypto';
import { isValidVisualScreenshot, MAX_VISUAL_SCREENSHOT_BYTES } from './visual-evidence';
import type { BudgetRepository } from './research-budget';

export interface AssetManifest { id:string; mime:'image/jpeg'; byteLength:number; createdAt:string }
export async function storeResearchAsset(repo:BudgetRepository,bytes:Uint8Array):Promise<AssetManifest>{
  const data=Buffer.from(bytes);
  if(data.length>MAX_VISUAL_SCREENSHOT_BYTES||!isValidVisualScreenshot(`data:image/jpeg;base64,${data.toString('base64')}`))throw new Error('Capture JPEG invalide ou supérieure à 100 Kio.');
  const id=createHash('sha256').update(data).digest('hex'),createdAt=new Date().toISOString();
  return repo.transaction(async tx=>{
    await tx.execute({sql:'INSERT OR IGNORE INTO research_assets(id,mime,data,byteLength,createdAt) VALUES (?,?,?,?,?)',args:[id,'image/jpeg',data,data.length,createdAt]});
    const row=(await tx.execute({sql:'SELECT id,mime,byteLength,createdAt FROM research_assets WHERE id=?',args:[id]})).rows[0];
    return {id:String(row.id),mime:'image/jpeg' as const,byteLength:Number(row.byteLength),createdAt:String(row.createdAt)};
  });
}
export async function getResearchAsset(repo:BudgetRepository,id:string):Promise<Uint8Array|null>{
  if(!/^[a-f0-9]{64}$/.test(id))return null;
  const row=(await repo.client.execute({sql:'SELECT data FROM research_assets WHERE id=?',args:[id]})).rows[0];if(!row)return null;
  return new Uint8Array(row.data as ArrayBuffer);
}
export async function listResearchAssets(repo:BudgetRepository):Promise<AssetManifest[]>{
  return (await repo.client.execute('SELECT id,mime,byteLength,createdAt FROM research_assets ORDER BY id')).rows as unknown as AssetManifest[];
}
