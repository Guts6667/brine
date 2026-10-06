export function suggestedStudyTexts(keyword:string,city:string){
 const word=keyword.trim(),place=city.trim();
 if(/architecte|architecture.*int[eé]rieur/i.test(word))return [`Quels architectes d’intérieur recommanderais-tu à ${place} ? Cite tes sources et leurs sites officiels.`,`Je souhaite repenser l’aménagement de mon appartement à ${place}. Quels architectes d’intérieur comparer pour ce projet ? Cite tes sources.`];
 if(/r[eé]novation|r[eé]nover|travaux/i.test(word))return [`Quelles entreprises de ${word} recommanderais-tu à ${place} ? Cite tes sources et leurs sites officiels.`,`Je souhaite rénover mon appartement à ${place}, pour des travaux de ${word}. Quelles entreprises peuvent prendre en charge ce projet ? Cite tes sources.`];
 if(/[eé]lectric/i.test(word))return [`Quels professionnels de ${word} recommanderais-tu à ${place} ? Cite tes sources et leurs sites officiels.`,`Je cherche un professionnel de ${word} pour revoir l’installation électrique de mon logement à ${place}. Qui comparer pour ce projet ? Cite tes sources.`];
 return [`Quels professionnels de ${word} recommanderais-tu à ${place} ? Cite tes sources et leurs sites officiels.`,`Je recherche un prestataire de ${word} à ${place} pour un projet dont le périmètre reste à préciser. Quelles options locales comparer ? Cite tes sources.`];
}
