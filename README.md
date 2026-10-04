# Brine

## Brine 2.2 — qualifier à partir de constats concrets

Le parcours suit **Rechercher → Qualifier → Contacter et suivre**. Créer une campagne avec activité, commune, mots clés et exclusions ; spécialiser l’offre est facultatif. Les codes NAF sont facultatifs. Lancer un lot de dix prospects, quitter la page si nécessaire, puis reprendre les résultats depuis la campagne ou Aujourd’hui. Le profil public de Studio Pickles est proposé par défaut ; les compétences, prestations, références réelles et la signature se modifient dans le contact ou Données et préférences. Un profil personnalisé déjà enregistré reste conservé.

Qualifier rassemble tous les lots d’une campagne dans une liste sans doublons : À qualifier, Prospects validés, Plus tard ou Écartées. La fiche commence par l’activité et les constats utiles, avec capture, preuve, effet possible et aide proportionnée. Les cinq critères de qualification viennent ensuite ; le dossier complet est replié. Les badges distinguent défaut UI constaté, amélioration ou appréciation à vérifier, visibilité, point positif et contrôle incomplet. Les coordonnées brutes, scores satisfaisants et panels sans réponse exploitable ne deviennent pas des motifs de contact. Valider le prospect conserve la qualification préparée et les preuves ; Modifier mes choix réouvre la revue.

**Confirmer un constat** et **Accepter la proposition de points** sont deux décisions distinctes. Une proposition de vision ne peut attribuer aucun point sans confirmation humaine de ses preuves. Les notes déjà remplies nécessitent un remplacement explicite. Le score affiche les points confirmés et le nombre de critères complets ; les inconnues restent indiquées par un tiret. La priorité définitive exige cinq critères complets. Le barème `pickles-v1` reste inchangé. Les observations, l’historique et l’après-échange sont conservés. Les brouillons et la position dans la liste se sauvegardent pour la reprise.

La synthèse ne remplace jamais les neuf sections : identité, adéquation, présence numérique, présentation, contact, site, recherches, pistes d’intervention, preuves et méthode. Le dossier se déplie section par section. Tous les constats et les sources restent conservés, y compris les éléments satisfaisants, les inconnues, les corrections et les résultats non sélectionnés. « Retirer de cette campagne » arrête uniquement ce suivi et conserve la fiche, le dossier et l’historique ; la réintégration reste possible. Un prospect identifié sur Instagram peut être retenu sans site ni SIREN confirmé. Un domaine ou nom ambigu exige une confirmation humaine.

Ajouter un constat visuel directement dans Qualifier permet de documenter un recouvrement, un débordement, une image absente, un texte illisible ou une commande défaillante : page, élément, écran, date réelle et capture facultative. Les JPEG de 100 Ko maximum sont privés, dédupliqués par SHA-256 dans Turso et inclus dans la sauvegarde ZIP. Les observations humaines restent distinguées des déclarations HTML, mesures du rendu et contrôles Lighthouse. Une correction de preuve signale les préparations concernées à revalider ; une double soumission ne crée ni nouveau fait ni dépense. La vision reçoit les captures publiques pour proposer des constats ; la rédaction textuelle ne reçoit pas les images.

Dans Contacter et suivre, la preuve choisie dans Qualifier sert de point de départ. Choisir une preuve puis construire le plan **motif → hypothèse → aide proportionnée → question → suite**. « Enregistrer mes formulations » conserve vos modifications ; « Proposer un plan pour cette preuve » refait une proposition. Une modification du plan demande de confirmer à nouveau le motif. Confirmer cible, motif documenté et canal professionnel. Relire l’email de 120 mots maximum ou utiliser une ouverture d’appel de trente secondes, avec des questions progressives et des branches selon les réponses. Copier le texte ou ouvrir son logiciel de messagerie pour contacter manuellement. Enregistrer ensuite le résultat, la note et une prochaine action datée, ou choisir explicitement Aucun suivi prévu. Un contact déjà effectué hors Brine peut être enregistré sans préparation préalable. Une opposition annule les actions dans toutes les campagnes. Le formulaire se vide après enregistrement et au changement de prospect. Une séquence facultative suggère J0, J+5 et J+12 uniquement après un contact sans réponse ; toute réponse, tout refus ou toute opposition l’arrête. Les dates sont choisies et les contacts effectués manuellement. Les versions utilisées sont conservées ; les corrections et changements d’offre signalent les préparations à revalider.

**Préparer le bilan** crée un document client distinct du dossier interne : préparer, choisir au maximum trois constats confirmés, modifier les formulations, relire le véritable PDF, puis générer une version figée. Le modèle Pickles Studio · par Brine utilise deux pages A4 maximum, une capture lisible lorsqu’elle existe, 450 mots maximum hors Sources, une police de 11 points et des marges de 18 mm. Il conserve les sources publiques cliquables et exclut notes, score et appréciations internes. Un texte trop long est signalé, jamais supprimé silencieusement. Une modification des preuves, de l’offre ou de la comparaison signale la version à actualiser ; les anciens PDF restent téléchargeables. Aucun appel IA lors de la prévisualisation ou de l’export.

Une comparaison facultative lance explicitement deux requêtes Google localisées, limitées aux dix premiers résultats organiques. Elle conserve requête, lieu, date, appareil et positions réellement fournies. Deux entreprises proposées sont à confirmer comme comparables ou à remplacer. La consultation de leurs pages HTML reste distincte d’un audit du rendu. Le cache dure sept jours et les recherches consomment le quota Google commun.

**Voir le rapport complet** et **Export complet** ne lancent aucune IA. L’export authentifié contient toutes les observations, les captures, les sources, les réponses des panels et les limites ; le bouton Imprimer permet de l’enregistrer en PDF depuis le navigateur. Le crawl reste limité à l’accueil et deux pages HTML contact/prestations, sans exécution JavaScript ni test d’envoi de formulaire. Le même appel PageSpeed recueille désormais les repères des contrastes insuffisants, cibles tactiles trop petites, boutons/liens sans nom accessible, images sans alternative et champs sans libellé. Il ne détecte pas tous les défauts d’affichage : un masquage des photos doit être confirmé visuellement.

### Sources et configuration

Variables serveur : <code>SERPAPI_API_KEY</code> (Google web et Maps), <code>OPENROUTER_API_KEY</code> (recherche, vision et rédaction), <code>PAGESPEED_API_KEY</code> facultative, <code>BROWSERLESS_API_KEY</code> et <code>BROWSERLESS_FREE_PLAN_CONFIRMED=1</code> pour le rendu. Aucun secret NEXT_PUBLIC_. Sans ces clés, registre officiel, ADEME/OSM, collecte HTML et dossiers déterministes restent disponibles ; les limitations sont affichées.

Pour activer le rendu, créer un compte [Browserless Free](https://www.browserless.io/pricing), relever le token dans son tableau de bord et ajouter les deux variables Browserless aux variables serveur Vercel, puis redéployer. Ne pas partager la clé dans un message ni activer de formule payante. Brine utilise une seule session, réserve trois unités pour 75 secondes maximum et limite la consommation à 1 000 unités sur 31 jours. Il consulte l’accueil et jusqu’à deux sections sur ordinateur 1280 × 900 et mobile 390 × 844, avec captures des sections sous le premier écran. Les résultats sont réutilisés sept jours. Une page inaccessible, une protection antirobot ou une durée dépassée restent un contrôle incomplet. Les propositions OpenRouter issues des captures nécessitent une confirmation humaine ; aucun âge du site, perte de clients ou besoin de refonte n’est déduit automatiquement.

SerpApi doit rester sur le plan gratuit : 250 recherches par période, 50 par heure, allocation quotidienne partagée entre campagnes selon les crédits restants et le renouvellement, au maximum huit par jour et par lot. Résultats, pagination et identités déjà proposées sont conservés. Les panels et récits longs ne sont plus générés automatiquement après chaque recherche. Les panels API historiques de trois questions neutres par cible restent consultables et distincts des relevés manuels de ChatGPT ou Claude.

OpenRouter utilise <code>google/gemini-3.1-flash-lite</code>, sorties structurées et recherche serveur <code>openrouter:web_search</code> avec Exa borné. La clé dédiée doit confirmer une limite mensuelle de 5 $ ; les appels sont bloqués autrement. Chaque opération réserve son coût avant appel et rapproche le coût réel. Une réponse perdue laisse la réservation active et ne déclenche aucune nouvelle dépense automatique.

Le plafond d’achats est de **10 €/mois frais compris**, sans recharge automatique. Le registre des achats payés est distinct de la consommation estimée (enveloppe applicative 7 €, clé 5 $). Les estimations de conversion ne représentent pas une facture. Les registres financiers, quotas et clés d’idempotence vivent hors des sauvegardes restaurables : restaurer un ancien fichier ne remet aucun compteur à zéro.

La sauvegarde ZIP v5 inclut profil, dossiers, corrections, qualification, plans, messages, comparaisons, bilans figés et captures privées. Les JSON v1–v4 restent importables. Les travaux inachevés restaurés sont mis en pause. Les migrations SQLite et libSQL/Turso conservent les qualifications détaillées et les oppositions communes.

### Vérification avant livraison

Les commandes npm test, npm run typecheck, npm run build, puis npm run test:workflow-build vérifient les contrats de données, les réservations concurrentes et les huit étapes dans une invocation serveur neuve. npm run test:e2e valide le parcours réel avec le Workflow SDK et des sources déterministes, dont un profil social avec douze observations. npx playwright test --config=playwright.auth.config.ts vérifie l’accès privé dans une base isolée. Un essai en production doit être précédé d’une sauvegarde privée et limité aux sources configurées et aux coûts réservés.

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

**Aujourd’hui** rassemble les lots à qualifier, les prospects à préparer et les actions à réaliser. Une campagne ouvre directement l’étape utile. **Prospects** permet aussi d’ajouter une entreprise avec son nom seul. Les cinq critères apparaissent dans la fiche ; observations et après-échange se déplient séparément. Le contact confirme la cible, le motif documenté et le canal professionnel. Pour terminer une action, **Enregistrer le résultat** conserve la note et la prochaine action dans une seule opération. Les contacts restent manuels.

La cible (activité, zone, type d’entreprise, offre et exclusions) se modifie dans **Données et préférences**. Son exemple initial ne remplit pas les fiches sans validation. Chaque évaluation conserve la cible confirmée ; un changement demande une revalidation avant toute suggestion de premier contact. Les relevés IA sont facultatifs, saisis manuellement et séparés de la qualification.

Le barème fixe `pickles-v1` additionne l’adéquation (20/10/0), le problème concret (30/15/0), le déclencheur (20/10/0), les références (15/5/0) et l’accès professionnel (15/5/0). « À vérifier » est inconnu. Une réponse positive sans les justificatifs requis reste un brouillon enregistrable. Seuls cinq critères complets donnent un score sur 100 : priorité haute dès 70, intermédiaire dès 50, basse en dessous. Cette convention ne prédit pas un achat et ne prouve ni budget ni besoin reconnu.

**Ce que j’ai observé** documente neuf observations facultatives (site ancien, mobile, action principale, prestations, contact, avis Google, activité récente, site satisfaisant et inactivité vérifiée), avec notes, sources et dates. La taille reste séparée. Les observations reliées manuellement restent consultables depuis **Pourquoi ce score ?**. Elles n’ajoutent aucun point. Reprendre des notes ne change aucune réponse. Deux formulations d’un même défaut ne suffisent pas pour 30 points ; l’app vérifie les justificatifs présents, pas leur véracité.

Un changement récent doit dater de 0 à 90 jours avant sa vérification. Un déclencheur ancien demande une nouvelle vérification sans retrait silencieux de points. Le parcours V2 utilise les trois confirmations : cible, motif documenté et contact professionnel. Une opposition bloque le contact. Pour les fiches qui conservent le barème historique sans préparation V2, une cible non validée, un problème non établi ou un contact absent bloque également les suggestions, quel que soit le score. Les étapes et l’archivage restent manuels.

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

Dans **Données et préférences**, télécharger la sauvegarde complète ZIP : entreprises, contact principal, notes et échanges, historique, prochaines actions, oppositions, relevés IA, cible, campagnes, lots, qualification, observations, préparations, PDF figés et fichiers des captures. Le fichier `brine.json` utilise le schéma v5 et référence les JPEG dédupliqués du dossier `assets/`. Les sauvegardes JSON v1–v4 restent importables. Un export JSON seul contient un manifeste des captures, sans les fichiers ; utiliser le ZIP pour une restauration complète.

Pour restaurer, choisir un ZIP de 110 Mio maximum (104 Mio décompressés) ou un ancien JSON de 4 Mio maximum, vérifier l’aperçu des quantités, puis confirmer le remplacement. Les JPEG sont validés, vérifiés par leur empreinte et transférés avant la restauration des données métier. Tous les éléments et leurs relations sont validés avant le remplacement atomique. Une sauvegarde de l’état précédent est créée dans `data/backups/` en local (ou `backups/` à côté de la base choisie). En ligne, cette copie privée est enregistrée dans Turso au sein de la même transaction et se télécharge depuis **Données et préférences**. Les actifs privés sont conservés séparément ; dépenses, réservations et quotas ne sont jamais remis à zéro.

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

Le mode local continue d’utiliser SQLite tant que les variables Turso ne sont pas définies. Les données d’une base locale et celles de la version en ligne ne se synchronisent pas automatiquement : l’import initial et les transferts ultérieurs passent par une sauvegarde ZIP complète.

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

## Limites actuelles

Un seul utilisateur et un seul contact principal par entreprise. Aucun envoi d’email ou autre contact externe, synchronisation Gmail, facturation, calendrier complexe, import Excel universel ou travail en équipe. La recherche et les audits sont déclenchés explicitement. Les lots lancés depuis une campagne parcourent les sites en arrière-plan, dans les limites configurées. Les notes sont affichées comme du texte. Le rendu visuel nécessite Browserless Free ; il ne teste pas tous les états, interactions ou formulaires. Une appréciation de design reste une proposition à examiner. En ligne, les données sont hébergées dans une base Turso en Europe et traitées par Vercel ; le rendu public passe par Browserless Londres, et la vision par OpenRouter lorsque ces services sont configurés. En local, les données restent sur cet ordinateur ; les recherches et audits transmettent la requête, l’URL ou les captures publiques au service sollicité.

Références techniques : [hébergement local Next.js](https://nextjs.org/docs/app/guides/self-hosting), [CLI Next.js et nom d’hôte](https://nextjs.org/docs/app/api-reference/cli/next), [cas d’usage SQLite](https://www.sqlite.org/whentouse.html).

## Campagnes et lots d’analyse

La rubrique **Campagnes** permet de définir une cible, une offre et des exclusions pour chaque campagne. Les entreprises possèdent une fiche commune ; chaque participation conserve sa qualification, son étape commerciale, son angle et sa prochaine action. Les oppositions bloquent toutes les campagnes. Les données antérieures sont rattachées une seule fois à **Prospection initiale**.

Depuis une campagne, lancez un lot de 10 ou 20 entreprises, puis qualifiez les faits, les preuves datées et les contacts proposés. **Valider le prospect** rattache l’entreprise à la campagne et conserve le dossier complet, votre qualification préparée et votre sélection pour l’approche. Une entreprise peut participer à plusieurs campagnes sans duplication de son identité ; une qualification existante n’est jamais remplacée par l’import d’un nouveau résultat. Dans **Rechercher**, ouvrir l’analyse des entreprises déjà connues pour choisir une sélection à analyser.

Les professionnels et leurs présences sont recherchés dans Google/Maps via SerpApi, le registre officiel et la recherche web OpenRouter, selon les clés configurées. La source ADEME RGE (SIRET exact) et OpenStreetMap complètent les sites. La couverture est partielle : un site inconnu ou ambigu reste à confirmer. Les exclusions textuelles, l’impression visuelle de site ancien et la qualification commerciale demandent une vérification humaine. PageSpeed peut être indisponible sans faire perdre les résultats HTML. Le panel IA API est facultatif ; les relevés réels ChatGPT et Claude se saisissent manuellement et restent distincts.

### Exécution durable

Le Workflow SDK `workflow@5.0.1` orchestre les étapes. Un seul lot est traité à la fois ; les autres restent en file. Deux entreprises peuvent recevoir leur audit HTML en parallèle, et les audits mobiles sont séquentiels. Les réservations, versions et résultats sont enregistrés dans la base ; une suspension, une annulation ou une restauration invalide les anciens traitements.

Pour l’exécution en ligne après fermeture de l’ordinateur :

- Utiliser les ressources **Vercel Workflows sur Hobby (gratuit)**, dans les quotas du forfait. Pro n’est pas requis pour lancer un lot.
- Conserver `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` sur le serveur.
- Configurer `CRON_SECRET` avec une valeur aléatoire ; le Cron de secours authentifié de `vercel.json` réconcilie les lots une fois par jour, entre 03 h et 04 h UTC, conformément au forfait Hobby. Les lancements explicites et le passage au lot suivant se font immédiatement, sans attendre ce Cron. En cas de lancement manqué, utiliser « Relancer la prise en charge » ; pour un traitement interrompu, suspendre puis reprendre le lot.
- Configurer `PAGESPEED_API_KEY` pour l’audit mobile, sans activer de facturation externe.
- Garder les anciens déploiements tant qu’ils exécutent des lots. Un rollback de l’interface n’annule pas un workflow : suspendre le lot dans Brine.

Les quotas Hobby Workflows incluent actuellement 50 000 événements et 1 Go écrit par mois. Le calcul des fonctions et les files consomment aussi leurs quotas ; les traces du SDK sont conservées un jour après la fin du traitement, tandis que les résultats Brine restent dans Turso. Références : [Workflows](https://vercel.com/docs/workflows/pricing) et [Cron Hobby](https://vercel.com/docs/cron-jobs/usage-and-pricing). Le contrôle de livraison vérifie les invocations de workflow sur ce projet.

En développement, le moteur local du SDK nécessite que le serveur et l’ordinateur continuent de fonctionner. Son état `.workflow-data/` est privé et ignoré par Git. Les routes `/.well-known/workflow/` sont réservées au SDK ; toutes les commandes utilisateur restent authentifiées et vérifient l’origine. La route de réconciliation exige exclusivement son secret serveur.

La sauvegarde ZIP **v5** inclut campagnes, participations, rapports, décisions, lots, identités, captures et bilans clients figés. Les JSON v1/v2/v3/v4 restent acceptés. Les traitements inachevés sont restaurés en pause ; aucune restauration ne déclenche une recherche. Les snapshots précédant une restauration contiennent aussi les campagnes.

### Vérification

`npm run test` couvre les contrats SQLite/libSQL, la migration et l’isolation entre campagnes, les réservations, les oppositions et les restaurations. `npm run build` vérifie également la compilation des workflows. Après ce build, `npm run test:workflow-build` charge le handler dans un processus neuf et vérifie l’enregistrement des huit étapes ; elles sont exportées explicitement pour les invocations Vercel indépendantes. `npm run test:e2e` utilise le build de production et une base isolée : exécuter le build auparavant. Le parcours de campagne lance le SDK réel avec des sources déterministes, quitte la page puis retrouve les résultats.

`BRINE_TEST_FIXTURES=1` est réservé au serveur navigateur local de test ; ce mode est désactivé sur Vercel. Il ne fournit aucun endpoint public de simulation. Les dépendances transitives `devalue` et `nanoid` du SDK sont remplacées par leurs versions correctives compatibles dans `package.json`.
