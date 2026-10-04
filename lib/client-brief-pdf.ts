import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, rgb, PDFString, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ClientBrief } from './client-brief';
import { clientBriefWordCount } from './client-brief';

const A4:[number,number]=[595.28,841.89],MARGIN=51.03,WIDTH=A4[0]-2*MARGIN;
const cream=rgb(.953,.941,.918),ink=rgb(.02,.02,.02),green=rgb(.718,.839,.310),muted=rgb(.32,.34,.31);
export class BriefLayoutError extends Error { constructor(){super('Le bilan ne tient pas sur deux pages lisibles. Allégez les textes ou réduisez explicitement les points sélectionnés.');} }
function lines(text:string,font:PDFFont,size:number,width:number):string[]{
  const result:string[]=[];for(const paragraph of text.split('\n')){if(!paragraph.trim()){result.push('');continue;}let line='';for(const word of paragraph.split(/\s+/)){if(font.widthOfTextAtSize(word,size)>width)throw new BriefLayoutError();const next=line?`${line} ${word}`:word;if(font.widthOfTextAtSize(next,size)>width){result.push(line);line=word;}else line=next;}result.push(line);}return result;
}
/** Deterministic layout, never a browser or an AI call. Overflow is a review error, not truncation. */
export async function renderClientBriefPdf(brief:ClientBrief,loadAsset:(id:string)=>Promise<Uint8Array|null>):Promise<Uint8Array>{
  if(clientBriefWordCount(brief)>450)throw new BriefLayoutError();
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const fontBytes=await readFile(join(process.cwd(),'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff'));
  const boldBytes=await readFile(join(process.cwd(),'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff'));
  const [font,bold]=await Promise.all([pdf.embedFont(fontBytes,{subset:true}),pdf.embedFont(boldBytes,{subset:true})]);
  pdf.setTitle(`Bilan de présence numérique - ${brief.companyName}`);pdf.setAuthor('Pickles Studio · par Brine');pdf.setSubject('Constats confirmés et pistes à discuter');pdf.setCreationDate(new Date(brief.createdAt));
  const logo=await pdf.embedPng(await readFile(join(process.cwd(),'public/pickles-logo.png')));
  const date=new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeZone:'Europe/Paris'}).format(new Date(brief.createdAt));
  const pages=[pdf.addPage(A4),pdf.addPage(A4)];
  function link(page:PDFPage,label:string,url:string,y:number,size=11){
    page.drawText(label,{x:MARGIN,y,size,font,color:ink});const annotation=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[MARGIN,y-2,MARGIN+font.widthOfTextAtSize(label,size),y+size+2],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}});const reference=pdf.context.register(annotation);page.node.addAnnot(reference);
  }
  for(let index=0;index<pages.length;index++){
    const page=pages[index];page.drawRectangle({x:0,y:0,width:A4[0],height:A4[1],color:cream});page.drawRectangle({x:0,y:A4[1]-94,width:A4[0],height:94,color:ink});page.drawImage(logo,{x:MARGIN,y:A4[1]-71,width:138,height:20});page.drawText('par Brine',{x:MARGIN+151,y:A4[1]-66,size:11,font,color:cream});page.drawText(date,{x:A4[0]-MARGIN-font.widthOfTextAtSize(date,11),y:A4[1]-66,size:11,font,color:cream});
    page.drawRectangle({x:MARGIN,y:74,width:WIDTH,height:1,color:green});page.drawText('Pickles Studio · par Brine',{x:MARGIN,y:MARGIN,size:11,font,color:muted});page.drawText(`${index+1} / 2`,{x:A4[0]-MARGIN-28,y:MARGIN,size:11,font,color:muted});
  }
  const cursor=[A4[1]-116,A4[1]-116];
  function block(pageIndex:number,text:string,heading=false){const size=heading?15:11,leading=heading?20:15,used=heading?bold:font;const wrapped=lines(text,used,size,WIDTH);if(cursor[pageIndex]-wrapped.length*leading<90)throw new BriefLayoutError();for(const line of wrapped){pages[pageIndex].drawText(line,{x:MARGIN,y:cursor[pageIndex],size,font:used,color:ink});cursor[pageIndex]-=leading;}cursor[pageIndex]-=heading?8:9;}
  block(0,brief.companyName,true);block(0,'Votre présence numérique, en quelques points',true);block(0,brief.situation);
  if(brief.positives){block(0,'Ce qui fonctionne',true);block(0,brief.positives);}
  for(let index=0;index<brief.points.length;index++){const point=brief.points[index];block(0,`${index+1}. ${point.text}`);if(point.effect)block(0,`Effet possible : ${point.effect}`);if(point.help)block(0,`Aide envisageable : ${point.help}`);}
  const pictures=brief.points.filter(point=>point.fact.visual?.assetId||point.fact.visual?.screenshot).slice(0,1);
  if(pictures.length){const cells= pictures.length===2?2:1,cellWidth=(WIDTH-(cells-1)*12)/cells,images=[];
    for(const point of pictures){const visual=point.fact.visual!,bytes=visual.assetId?await loadAsset(visual.assetId):Buffer.from(visual.screenshot!.split(',')[1],'base64');if(!bytes)throw new Error('Une capture confirmée manque. Restaurez ses fichiers avant de générer le PDF.');const img=await pdf.embedJpg(bytes),scale=Math.min(cellWidth/img.width,180/img.height);images.push({img,width:img.width*scale,height:img.height*scale,caption:`${visual.device==='mobile'?'Mobile':'Ordinateur'} · ${point.fact.observedOn.slice(0,10)}`});}
    const height=Math.max(...images.map(image=>image.height));if(cursor[0]-height-30<90)throw new BriefLayoutError();for(let index=0;index<images.length;index++){const image=images[index],x=MARGIN+index*(cellWidth+12);pages[0].drawImage(image.img,{x,y:cursor[0]-height,width:image.width,height:image.height});pages[0].drawText(image.caption,{x,y:cursor[0]-height-18,size:11,font,color:muted});}cursor[0]-=height+35;
  }
  block(1,'Repères et prochaines étapes',true);
  if(brief.comparison?.queries.length){block(1,'Résultats Google observés',true);for(const query of brief.comparison.queries){block(1,`« ${query.query} » · ${query.location} · ${query.recordedAt.slice(0,10)} · ordinateur`);const ownHost=brief.website,ownDomain=ownHost?new URL(ownHost).hostname.replace(/^www\./,''):null;const own=ownDomain?query.results.find(result=>new URL(result.url).hostname.replace(/^www\./,'')===ownDomain):null;block(1,own?`Position organique observée : ${own.position} parmi les dix premiers résultats consultés.`:'Entreprise non identifiée parmi les dix premiers résultats consultés ; aucune absence générale déduite.');}
    for(const competitor of brief.comparison.competitors.filter(c=>c.confirmed)){block(1,competitor.name);for(const note of competitor.notes)block(1,note);}
  }else block(1,'Comparaison non disponible pour ce bilan. Aucun classement n’est déduit de cette absence de contrôle.');
  block(1,'Actions utiles',true);for(const action of brief.actions)block(1,action);block(1,brief.invitation);
  block(1,'Sources et périmètre',true);
  for(const source of brief.sources){const label=`${source.provider==='manual'?'Vérification visuelle':source.provider==='browserless'?'Page consultée':source.provider==='pagespeed'?'Mesure mobile':'Source publique'} · ${new URL(source.url).hostname} · ${source.collectedAt.slice(0,10)||'date non renseignée'}`;if(cursor[1]-16<90)throw new BriefLayoutError();link(pages[1],label,source.url,cursor[1]);cursor[1]-=16;}
  if(brief.comparison)for(const competitor of brief.comparison.competitors.filter(c=>c.confirmed)){if(cursor[1]-16<90)throw new BriefLayoutError();link(pages[1],`Comparatif · ${new URL(competitor.url).hostname} · ${competitor.checkedAt.slice(0,10)}`,competitor.url,cursor[1]);cursor[1]-=16;}
  if(cursor[1]-45<90)throw new BriefLayoutError();block(1,'Vérifications ponctuelles sur les pages et écrans cités. Les effets possibles restent à confirmer avec vous.');
  pdf.setModificationDate(new Date(brief.createdAt));
  const bytes=await pdf.save();if(bytes.length>4*1024*1024)throw new Error('Le PDF dépasse la taille autorisée. Réduisez explicitement les captures.');return bytes;
}
