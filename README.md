# Brine

Une application personnelle, en français, pour choisir une entreprise, comprendre pourquoi la contacter et décider de la prochaine action. La base de travail démarre vide. Le mode local ne nécessite aucun compte ni clé API. La version en ligne utilise Vercel et une base Turso privée. L’interface reprend les contrastes de [Studio Pickles](https://www.studiopickles.io/en) : noir, crème, accent citron, boutons en pilule et titres sans sérif/italique. Les polices utilisent les ressources du système, sans téléchargement externe.

## Installation et lancement

Utiliser Node.js 24 et npm, puis depuis ce dossier :

```sh
npm install
npm run dev
```

Ouvrir [Brine](http://127.0.0.1:3000). Pour un lancement avec le build de production :

```sh
npm run build
npm start
```

Les commandes locales écoutent sur `127.0.0.1`. La version hébergée fonctionne sur HTTPS, avec un mot de passe et une base partagée entre vos appareils.

## Usage et données

**Aujourd’hui** rassemble les actions en retard, celles du jour et les prospects prêts pour un premier contact, sans date planifiée, classés par score. **Prospects** permet d’ajouter une entreprise avec son nom seul. Sur sa fiche, enregistrer le contact et les observations, confirmer les cinq critères, puis utiliser **Prévoir la suite**. Terminer une action la conserve dans l’historique. Les étapes commerciales restent manuelles.

La cible (activité, zone, type d’entreprise, offre et exclusions) se modifie dans **Données et préférences**. Son exemple initial ne remplit pas les fiches sans validation. Chaque évaluation conserve la cible confirmée ; un changement demande une revalidation avant toute suggestion de premier contact. Les relevés IA sont facultatifs, saisis manuellement et séparés de la qualification.

Le barème fixe `pickles-v1` additionne l’adéquation (20/10/0), le problème concret (30/15/0), le déclencheur (20/10/0), les références (15/5/0) et l’accès professionnel (15/5/0). « À vérifier » est inconnu. Une réponse positive sans les justificatifs requis reste un brouillon enregistrable. Seuls cinq critères complets donnent un score sur 100 : priorité haute dès 70, intermédiaire dès 50, basse en dessous. Cette convention ne prédit pas un achat et ne prouve ni budget ni besoin reconnu.

**Ce que j’ai observé** documente neuf observations facultatives (site ancien, mobile, action principale, prestations, contact, avis Google, activité récente, site satisfaisant et inactivité vérifiée), avec notes, sources et dates. La taille reste séparée. Les observations reliées manuellement restent consultables depuis **Pourquoi ce score ?**. Elles n’ajoutent aucun point. Reprendre des notes ne change aucune réponse. Deux formulations d’un même défaut ne suffisent pas pour 30 points ; l’app vérifie les justificatifs présents, pas leur véracité.

Un changement récent doit dater de 0 à 90 jours avant sa vérification. Un déclencheur ancien demande une nouvelle vérification sans retrait silencieux de points. Une opposition, une cible non validée, un problème non établi ou un contact absent bloque les suggestions, quel que soit le score. Les étapes et l’archivage restent manuels.

## Recherche et analyse automatiques

Dans **Prospects → Trouver des entreprises**, rechercher par commune et activité déclarée via l’API publique Recherche d’entreprises, sans compte ni clé API. La commune est résolue avec l’API Découpage administratif. Choisir une activité proposée ou des codes NAF, puis ajouter les résultats voulus. Les établissements fermés sont écartés ; le compteur du registre peut donc dépasser le nombre de résultats affichés. Les noms de communes ambigus demandent un code INSEE. L’import ajoute des fiches « À étudier » et conserve la source, le SIREN/SIRET et la date dans l’historique. Il rapproche les doublons sans remplacer les fiches, archives ou oppositions existantes. Le registre ne fournit pas les sites ou les coordonnées : renseigner le site officiel sur la fiche avant son analyse.

Sur une fiche, **Analyser le site** consulte le HTML public de l’accueil et de deux pages de contact ou de prestations au maximum. Les règles `robots.txt` sont respectées ; les adresses privées, redirections dangereuses, pages trop volumineuses et délais excessifs sont bloqués. Aucune exécution JavaScript : le rendu visuel, les formulaires et certains contenus dynamiques peuvent demander une vérification supplémentaire. L’outil relève les canaux de contact publiés, la balise viewport, les liens d’action/prestations et les liens importants répondant 404, 410 ou en erreur serveur. Chaque constat conserve sa source et sa date. Un copyright ancien ne prouve pas l’âge du site.

**Tester sur mobile (PageSpeed)** appelle le service Google pour un test de chargement mobile simulé et des vérifications Lighthouse. La variable serveur facultative `PAGESPEED_API_KEY` permet d’utiliser une clé Google lorsque le quota sans clé est indisponible. Le résultat décrit ce test ponctuel ; il ne prouve ni un mauvais rendu sur tous les téléphones, ni une perte de clients. Les mesures, sources et angles d’approche proposés peuvent être enregistrés dans l’historique.

Sélectionner explicitement les coordonnées et constats à conserver. Seuls les champs de contact vides sont complétés ; les constats et angles restent dans les notes. Les réponses de qualification et les étapes commerciales restent à confirmer. Une analyse signée expire après vingt minutes ; toute modification de la fiche demande une nouvelle analyse avant l’application. Les contacts et leur provenance sont enregistrés dans une même transaction, en local comme sur Turso.

**Tests IA** propose trois questions à copier dans ChatGPT, Claude ou un autre outil avec recherche web. Les tests de ces applications restent manuels : conserver les réponses, l’interface, la date, les compteurs et un lien de preuve. Un angle peut décrire l’absence de recommandation dans un panel documenté ; il ne prétend jamais à une absence générale de visibilité. Un appel à une API de modèle ne reproduit pas automatiquement la recherche d’une application. Aucun message de prospection n’est envoyé.

Le volet replié **Après l’échange** distingue besoin, calendrier, budget, décision, capacité à avancer, solution et prochaine étape acceptée. Il ne crée aucun second score. La transition explicite **Passer à Opportunité qualifiée** exige un besoin reconnu, une solution pertinente, un chemin de décision identifié et une étape acceptée, sans opposition ni blocage confirmé. Un budget inconnu reste à vérifier. Une contradiction ultérieure demande une réévaluation et conserve l’historique.

SQLite conserve les données dans `data/brine.sqlite`, avec les fichiers associés `-wal` et `-shm` pendant l’utilisation. Si une installation possède déjà `data/pickles.sqlite` et aucune base `data/brine.sqlite`, Brine continue d’utiliser cette base existante. Les migrations versionnées se trouvent dans `migrations/` et s’appliquent au démarrage. Le dossier des données est exclu de Git et de `public/`. Pour choisir une autre base :

```sh
BRINE_DB_PATH=/chemin/prive/brine.sqlite npm run dev
```

La variable historique `PICKLES_DB_PATH` reste prise en charge ; `BRINE_DB_PATH` est prioritaire si les deux sont définies.

L’archivage est réversible. **Ne plus contacter** est distinct de l’étape et de l’archivage : il annule les actions actives et reste conservé jusqu’à une réactivation explicitement confirmée sur la fiche.

## Sauvegarde et restauration

Dans **Données et préférences**, télécharger la sauvegarde JSON complète : entreprises, contact principal, notes et échanges, historique, prochaines actions, oppositions, relevés IA et cible. Le fichier utilise le schéma v3, incluant campagnes, lots, qualification, observations, cible utilisée et après-échange. Les sauvegardes v1 et v2 restent importables : les anciennes réponses sont conservées sans déduction vers les nouveaux critères, qui démarrent à « À vérifier ».

Pour restaurer, choisir un JSON de 5 Mo maximum, vérifier l’aperçu des quantités, puis confirmer le remplacement. Tous les éléments et leurs relations sont validés avant l’écriture. Le remplacement est atomique. Une sauvegarde de l’état précédent est créée dans `data/backups/` en local (ou `backups/` à côté de la base choisie). En ligne, cette copie privée est enregistrée dans Turso au sein de la même transaction et se télécharge depuis **Données et préférences**.

Les oppositions existantes restent actives, même si le fichier restauré les omet. Elles sont rapprochées par identifiant, domaine ou nom et ville ; un domaine partagé peut donc conserver une opposition sur plusieurs fiches. Les fiches opposées absentes du fichier sont conservées et archivées. Une restauration ne réactive jamais le contact : cette décision se confirme ensuite sur la fiche.

Les sauvegardes contiennent des coordonnées et ne sont pas chiffrées par défaut. Conserver une copie dans un emplacement privé adapté.

## Version en ligne et accès privé

Le projet Vercel est `guts6667s-projects/brine`. Le stockage distant utilise le plan Turso `starter` gratuit, région Dublin. Les variables côté serveur sont :

- `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` : connexion à la base privée.
- `BRINE_PASSWORD_HASH` : hash scrypt salé du mot de passe.
- `BRINE_SESSION_SECRET` : clé aléatoire d’au moins 32 caractères.
- `BRINE_APP_ORIGIN` : origine HTTPS du domaine de production, si personnalisée. Les URL de déploiement Vercel sont également reconnues par leurs variables système.

Sur Vercel, une configuration de connexion ou de stockage incomplète bloque l’accès. L’application ne crée jamais une base locale de secours dans une fonction. Toutes les pages, sauvegardes et mutations sont protégées. La session dure 8 heures, dans un cookie HttpOnly, Secure et SameSite=Lax. Les tentatives de connexion sont limitées à 10 par adresse IP sur 15 minutes, avec un compteur persistant ; les adresses sont hachées et les mots de passe ne sont pas enregistrés en clair.

Les secrets sont exclus du dépôt et de l’envoi du code. Le fichier privé `.vercel/acces-brine.txt` contient le mot de passe initial. Pour le changer, générer un nouveau hash avec `hashPassword` de `lib/auth.ts`, remplacer la variable Vercel et redéployer. Changer le hash ou la clé de session invalide les sessions précédentes. Ne jamais utiliser de variable `NEXT_PUBLIC_` pour un secret.

Pour mettre à jour une version déjà configurée :

```sh
npm run typecheck
npm test
npm run build
git push origin main
```

Le mode local continue d’utiliser SQLite tant que les variables Turso ne sont pas définies. Les données d’une base locale et celles de la version en ligne ne se synchronisent pas automatiquement : l’import initial et les transferts ultérieurs passent par une sauvegarde JSON complète.

## Vérifications

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npx playwright test --config playwright.auth.config.ts
```

Les tests de stockage utilisent des bases temporaires. Playwright démarre sur `127.0.0.1:3100` avec une base dédiée `test-results/e2e/brine.sqlite`, réinitialisée avant chaque exécution ; il ne touche pas la base de travail. Les tests navigateur couvrent le parcours principal, les oppositions, l’archivage, les relevés IA, la restauration, le clavier, l’affichage étroit et le rejet d’origines non autorisées.

## Limites de la V1

Un seul utilisateur et un seul contact principal par entreprise. Aucun envoi d’email ou autre contact externe, synchronisation Gmail, appel d’API IA, audit visuel automatisé, PDF, facturation, calendrier complexe, import Excel universel ou travail en équipe. La recherche et les audits sont déclenchés explicitement. Les lots lancés depuis une campagne parcourent les sites en arrière-plan, dans les limites configurées. Les notes sont affichées comme du texte. En ligne, les données sont hébergées dans une base Turso en Europe et traitées par Vercel. En local, elles restent sur cet ordinateur ; les recherches et audits transmettent la requête ou l’URL au service sollicité.

Références techniques : [hébergement local Next.js](https://nextjs.org/docs/app/guides/self-hosting), [CLI Next.js et nom d’hôte](https://nextjs.org/docs/app/api-reference/cli/next), [cas d’usage SQLite](https://www.sqlite.org/whentouse.html).

## Campagnes et lots d’analyse

La rubrique **Campagnes** permet de définir une cible, une offre et des exclusions pour chaque campagne. Les entreprises possèdent une fiche commune ; chaque participation conserve sa qualification, son étape commerciale, son angle et sa prochaine action. Les oppositions bloquent toutes les campagnes. Les données antérieures sont rattachées une seule fois à **Prospection initiale**.

Depuis une campagne, lancez un lot de 10 ou 20 entreprises, puis examinez les faits, les preuves datées et les contacts proposés. **Retenir** rattache l’entreprise à la campagne et conserve uniquement votre sélection. Une entreprise peut participer à plusieurs campagnes sans duplication de son identité. L’onglet **Prospects** permet aussi d’analyser une sélection d’entreprises déjà connues.

Les sites sont recherchés dans la source ADEME RGE (SIRET exact), puis dans OpenStreetMap en complément. La couverture est partielle : un site inconnu ou ambigu reste à confirmer. Les exclusions textuelles, l’impression visuelle de site ancien et la qualification commerciale demandent une vérification humaine. PageSpeed peut être indisponible sans faire perdre les résultats HTML. Les tests IA restent facultatifs et manuels.

### Exécution durable

Le Workflow SDK `workflow@5.0.1` orchestre les étapes. Un seul lot est traité à la fois ; les autres restent en file. Deux entreprises peuvent recevoir leur audit HTML en parallèle, et les audits mobiles sont séquentiels. Les réservations, versions et résultats sont enregistrés dans la base ; une suspension, une annulation ou une restauration invalide les anciens traitements.

Pour l’exécution en ligne après fermeture de l’ordinateur :

- Utiliser les ressources **Vercel Workflows sur Hobby (gratuit)**, dans les quotas du forfait. Pro n’est pas requis pour lancer un lot.
- Conserver `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` sur le serveur.
- Configurer `CRON_SECRET` avec une valeur aléatoire ; le Cron de secours authentifié de `vercel.json` réconcilie les lots une fois par jour, entre 03 h et 04 h UTC, conformément au forfait Hobby. Les lancements explicites et le passage au lot suivant se font immédiatement, sans attendre ce Cron. En cas de lancement manqué, utiliser « Relancer la prise en charge » ; pour un traitement interrompu, suspendre puis reprendre le lot.
- Configurer `PAGESPEED_API_KEY` pour l’audit mobile, sans activer de facturation externe.
- Garder les anciens déploiements tant qu’ils exécutent des lots. Un rollback de l’interface n’annule pas un workflow : suspendre le lot dans Brine.

Les quotas Hobby Workflows incluent actuellement 50 000 événements et 1 Go écrit par mois. Le calcul des fonctions et les files consomment aussi leurs quotas ; les traces du SDK sont conservées un jour après la fin du traitement, tandis que les résultats Brine restent dans Turso. Références : [Workflows](https://vercel.com/docs/workflows/pricing) et [Cron Hobby](https://vercel.com/docs/cron-jobs/usage-and-pricing). La disponibilité sur ce projet reste à vérifier après déploiement.

En développement, le moteur local du SDK nécessite que le serveur et l’ordinateur continuent de fonctionner. Son état `.workflow-data/` est privé et ignoré par Git. Les routes `/.well-known/workflow/` sont réservées au SDK ; toutes les commandes utilisateur restent authentifiées et vérifient l’origine. La route de réconciliation exige exclusivement son secret serveur.

La sauvegarde **v3** inclut campagnes, participations, rapports, décisions, lots et identités. Les formats v1/v2 restent acceptés. Les traitements inachevés sont restaurés en pause ; aucune restauration ne déclenche une recherche. Les snapshots précédant une restauration contiennent aussi les campagnes.

### Vérification

`npm run test` couvre les contrats SQLite/libSQL, la migration et l’isolation entre campagnes, les réservations, les oppositions et les restaurations. `npm run build` vérifie également la compilation des workflows. Après ce build, `npm run test:workflow-build` charge le handler dans un processus neuf et vérifie l’enregistrement des six étapes ; elles sont exportées explicitement pour les invocations Vercel indépendantes. `npm run test:e2e` utilise le build de production et une base isolée : exécuter le build auparavant. Le parcours de campagne lance le SDK réel avec des sources déterministes, quitte la page puis retrouve les résultats.

`BRINE_TEST_FIXTURES=1` est réservé au serveur navigateur local de test ; ce mode est désactivé sur Vercel. Il ne fournit aucun endpoint public de simulation. Les dépendances transitives `devalue` et `nanoid` du SDK sont remplacées par leurs versions correctives compatibles dans `package.json`.
