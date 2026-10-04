import { createHash } from 'node:crypto';
import type { CampaignRepository } from './campaign-repository';
import { isValidVisualScreenshot } from './visual-evidence';
/** Convert legacy embedded JPEGs once; qualification answers and histories remain untouched. */
export async function migrateLegacyVisualAssets(repo:CampaignRepository){
  await repo.transaction(async tx=>{
    if((await tx.execute("SELECT value FROM campaign_meta WHERE id='visual-assets-v1'")).rows.length)return;
    const rows=await tx.execute('SELECT id,payload FROM discovery_candidates');
    for(const row of rows.rows){const value=JSON.parse(String(row.payload));let changed=false;
      async function visit(item:unknown):Promise<void>{
        if(!item||typeof item!=='object')return;const object=item as Record<string,unknown>;
        if(object.visual&&typeof object.visual==='object'){
          const visual=object.visual as Record<string,unknown>;
          if(typeof visual.screenshot==='string'&&isValidVisualScreenshot(visual.screenshot)){
            const bytes=Buffer.from(visual.screenshot.split(',')[1],'base64'),id=createHash('sha256').update(bytes).digest('hex');
            await tx.execute({sql:'INSERT OR IGNORE INTO research_assets(id,mime,data,byteLength,createdAt) VALUES (?,?,?,?,?)',args:[id,'image/jpeg',bytes,bytes.length,new Date().toISOString()]});visual.assetId=id;delete visual.screenshot;changed=true;
          }
          if(!object.review&&typeof object.id==='string'&&object.id.startsWith('visual-fact-')){object.review={state:'confirmed',nature:'observation',provenance:'manual',reviewedAt:new Date().toISOString()};changed=true;}
        }
        for(const child of Object.values(object))await visit(child);
      }
      await visit(value.research);if(changed)await tx.execute({sql:'UPDATE discovery_candidates SET payload=? WHERE id=?',args:[JSON.stringify(value),String(row.id)]});
    }
    await tx.execute("INSERT INTO campaign_meta(id,value) VALUES('visual-assets-v1','1')");
  });
}
